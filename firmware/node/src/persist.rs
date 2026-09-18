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

/// Last 16 KB reserved by memory.x: two required 4 KB sectors plus two spare sectors.
const RANGE: Range<u32> = 0x1FC000..0x20_0000;

/// Light settings and the chosen wifi.toml entry, independent records in one log.
const KEY: u8 = 0;
const NETWORK_KEY: u8 = 1;

/// ~24-byte settings records amortise erase wear; debounce saves across hundreds of records per sector pair.
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
