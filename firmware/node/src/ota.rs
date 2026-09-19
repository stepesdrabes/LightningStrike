//! Staging a firmware image in the spare slot.
//!
//! The image arrives over HTTP in whatever sizes TCP hands over and lands in flash one erase
//! sector at a time, each sector erased and then programmed exactly once.
//!
//! Nothing here makes the new image run; see [`crate::health`] for what does.

use embassy_boot::{FirmwareUpdater, FirmwareUpdaterConfig, State};
use embassy_embedded_hal::flash::partition::Partition;
use embassy_rp::flash::ERASE_SIZE;
use embassy_sync::blocking_mutex::raw::NoopRawMutex;
use embedded_storage_async::nor_flash::{NorFlash, ReadNorFlash};
use room_api::OtaError;

use crate::board::{Nvs, SharedFlash};

type Slot = Partition<'static, NoopRawMutex, Nvs>;

pub struct Ota {
	/// Staged into directly rather than through the updater. `write_firmware` remembers the
	/// last sector it erased, and that memory outlives an upload: a retry starting again at
	/// offset 0 would skip the erase for a sector the failed attempt had already written, and
	/// programming NOR only clears bits.
	dfu: Slot,
	/// Only for the state word, which is the one thing the bootloader reads.
	updater: FirmwareUpdater<'static, Slot, Slot>,
	capacity: usize,
	sector: [u8; ERASE_SIZE],
	filled: usize,
	/// Bytes already in flash, and so the offset the next flush writes at.
	flushed: usize,
	/// What the request said it would send, checked again before the image is marked bootable.
	expected: usize,
	/// Held from `begin` to `commit` or `abort`. It is the only thing serialising the two HTTP
	/// listeners, so only the connection whose `begin` returned `Ok` may clear it.
	busy: bool,
}

impl Ota {
	pub fn new(flash: &'static SharedFlash, state_word: &'static mut [u8]) -> Self {
		let config = FirmwareUpdaterConfig::from_linkerfile(flash, flash);
		// The settings store sits past DFU and nothing in the linker enforces that, so refuse
		// to boot a build whose memory.x has drifted rather than erase the room's settings.
		assert!(
			config.dfu.offset() + config.dfu.size() <= crate::persist::OFFSET,
			"DFU overlaps the settings store"
		);
		// DFU is one erase sector larger than ACTIVE, and an image has to fit ACTIVE.
		let capacity = config.dfu.capacity().saturating_sub(ERASE_SIZE);
		Self {
			dfu: config.dfu.clone(),
			updater: FirmwareUpdater::new(config, state_word),
			capacity,
			sector: [0; ERASE_SIZE],
			filled: 0,
			flushed: 0,
			expected: 0,
			busy: false,
		}
	}

	pub fn capacity(&self) -> usize {
		self.capacity
	}

	/// Whether this boot is the first for a freshly swapped image, and so still on trial.
	pub async fn on_trial(&mut self) -> bool {
		matches!(self.updater.get_state().await, Ok(State::Swap))
	}

	/// Stops the bootloader putting the old image back on the next reset.
	pub async fn confirm(&mut self) -> Result<(), OtaError> {
		self.updater.mark_booted().await.map_err(|_| OtaError::Flash)
	}

	/// Claims the slot. The caller owns it until it calls `commit` or `abort`, and must call one
	/// of them on every path.
	pub async fn begin(&mut self, len: usize) -> Result<(), OtaError> {
		if self.busy {
			return Err(OtaError::Busy);
		}
		if len > self.capacity {
			return Err(OtaError::TooLarge);
		}
		// Overwriting the slot during a trial would destroy the only image known to boot.
		if self.on_trial().await {
			return Err(OtaError::Unconfirmed);
		}
		self.filled = 0;
		self.flushed = 0;
		self.expected = len;
		self.busy = true;
		Ok(())
	}

	pub async fn write(&mut self, chunk: &[u8]) -> Result<(), OtaError> {
		if !self.busy {
			return Err(OtaError::OutOfOrder);
		}
		// Stop at what was declared rather than running off the end of the slot.
		if self.flushed + self.filled + chunk.len() > self.expected {
			return Err(OtaError::TooLarge);
		}

		let mut rest = chunk;
		while !rest.is_empty() {
			let take = (ERASE_SIZE - self.filled).min(rest.len());
			self.sector[self.filled..self.filled + take].copy_from_slice(&rest[..take]);
			self.filled += take;
			rest = &rest[take..];
			if self.filled == ERASE_SIZE {
				self.flush().await?;
			}
		}
		Ok(())
	}

	pub async fn commit(&mut self) -> Result<(), OtaError> {
		if !self.busy {
			return Err(OtaError::OutOfOrder);
		}
		self.flush().await?;
		// The last line of defence before an image is made bootable.
		if self.flushed != self.expected {
			return Err(OtaError::Truncated);
		}
		self.updater.mark_updated().await.map_err(|_| OtaError::Flash)?;
		self.busy = false;
		Ok(())
	}

	/// Releases the slot. Whatever was written stays where it is: without the mark left by
	/// `commit` the bootloader has no reason to look at it.
	pub fn abort(&mut self) {
		self.filled = 0;
		self.flushed = 0;
		self.expected = 0;
		self.busy = false;
	}

	/// One whole sector, erased then programmed. `flushed` only ever advances by `ERASE_SIZE`,
	/// so it is still sector aligned when a short final flush lands.
	async fn flush(&mut self) -> Result<(), OtaError> {
		if self.filled == 0 {
			return Ok(());
		}
		let from = self.flushed as u32;
		let to = from + ERASE_SIZE as u32;
		self.dfu.erase(from, to).await.map_err(|_| OtaError::Flash)?;
		self.dfu.write(from, &self.sector[..self.filled]).await.map_err(|_| OtaError::Flash)?;
		self.flushed += self.filled;
		self.filled = 0;
		Ok(())
	}
}
