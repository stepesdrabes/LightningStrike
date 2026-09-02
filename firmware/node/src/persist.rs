use core::ops::Range;

use embassy_rp::flash::{Async, Flash};
use embassy_rp::peripherals::FLASH;
use room_light::settings::{self, BLOB_LEN};
use room_light::state::LightState;
use sequential_storage::cache::{Cache, Uncached};
use sequential_storage::map::{MapConfig, MapStorage};

use crate::board::Store;
use crate::irq::Irqs;

const FLASH_SIZE: usize = 2 * 1024 * 1024;

/// The carve in memory.x: the last 16 KB of the part. Two 4 KB sectors are the map's minimum
/// and the spare pair is headroom for whatever 0.3 remembers.
const RANGE: Range<u32> = 0x1FC000..0x20_0000;

const KEY: u8 = 0;

/// The remembered light in flash. A record is ~24 bytes, so a sector pair holds hundreds per
/// erase cycle; at 100k rated cycles even a save every two seconds takes years to wear, and
/// saves are debounced far below that.
pub struct Persist {
	map: MapStorage<
		u8,
		Flash<'static, FLASH, Async, FLASH_SIZE>,
		Cache<Uncached, Uncached, Uncached, u8>,
	>,
	buf: [u8; 48],
}

impl Persist {
	pub fn new(store: Store) -> Self {
		let flash = Flash::new(store.flash, store.dma, Irqs);
		Self {
			map: MapStorage::new(flash, const { MapConfig::new(RANGE) }, Cache::new_uncached()),
			buf: [0; 48],
		}
	}

	/// Absent, stale-versioned or corrupt all read as the fixture's factory state.
	pub async fn load(&mut self, fallback: LightState) -> LightState {
		match self.map.fetch_item::<[u8; BLOB_LEN]>(&mut self.buf, &KEY).await {
			Ok(Some(blob)) => settings::decode(&blob).unwrap_or(fallback),
			_ => fallback,
		}
	}

	/// Best effort: a light that cannot save is still a light. An erase stalls XIP and IRQs for
	/// tens of ms, which is why saves are debounced rather than per-change.
	pub async fn save(&mut self, s: &LightState) {
		if let Err(e) = self.map.store_item(&mut self.buf, &KEY, &settings::encode(s)).await {
			log::warn!("settings save failed: {e:?}");
		}
	}
}
