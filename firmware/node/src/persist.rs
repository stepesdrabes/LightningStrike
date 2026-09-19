use embassy_embedded_hal::flash::partition::Partition;
use embassy_sync::blocking_mutex::raw::NoopRawMutex;
use room_light::settings::{self, BLOB_LEN};
use room_light::state::LightState;
use sequential_storage::cache::{Cache, Uncached};
use sequential_storage::map::{MapConfig, MapStorage};

use crate::board::{Nvs, SharedFlash};

/// Last 16 KB of the chip, past DFU so an update never disturbs it. Two required 4 KB sectors
/// plus two spare sectors.
pub const OFFSET: u32 = 0x1FC000;
const LEN: u32 = 16 * 1024;

/// Light settings and the chosen wifi.toml entry, independent records in one log.
const KEY: u8 = 0;
const NETWORK_KEY: u8 = 1;

/// ~24-byte settings records amortise erase wear; debounce saves across hundreds of records per sector pair.
pub struct Persist {
	map: MapStorage<
		u8,
		Partition<'static, NoopRawMutex, Nvs>,
		Cache<Uncached, Uncached, Uncached, u8>,
	>,
	buf: [u8; 48],
}

impl Persist {
	/// Addresses inside its own partition, so the range here is relative to `OFFSET`.
	pub fn new(flash: &'static SharedFlash) -> Self {
		let settings = Partition::new(flash, OFFSET, LEN);
		Self {
			map: MapStorage::new(settings, const { MapConfig::new(0..LEN) }, Cache::new_uncached()),
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

	/// Debounce saves because erase stalls XIP/IRQs for tens of milliseconds. Failure must not stop lighting.
	pub async fn save(&mut self, s: &LightState) {
		if let Err(e) = self.map.store_item(&mut self.buf, &KEY, &settings::encode(s)).await {
			log::warn!("settings save failed: {e:?}");
		}
	}

	/// An unreadable or out-of-range index reads as the first network, so a shorter wifi.toml
	/// still boots onto something.
	pub async fn load_network(&mut self) -> u8 {
		match self.map.fetch_item::<u8>(&mut self.buf, &NETWORK_KEY).await {
			Ok(Some(index)) => room_wifi::clamp(index),
			_ => 0,
		}
	}

	pub async fn save_network(&mut self, index: u8) {
		if let Err(e) = self.map.store_item(&mut self.buf, &NETWORK_KEY, &index).await {
			log::warn!("network save failed: {e:?}");
		}
	}
}
