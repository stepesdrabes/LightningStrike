use embassy_embedded_hal::adapter::BlockingAsync;
use esp_bootloader_esp_idf::partitions::{
	self, DataPartitionSubType, PartitionType, read_partition_table,
};
use esp_hal::peripherals::FLASH;
use esp_storage::FlashStorage;
use room_light::settings::{self, BLOB_LEN};
use room_light::state::LightState;
use sequential_storage::cache::{Cache, Uncached};
use sequential_storage::map::{MapConfig, MapStorage};

/// Use the partition table's NVS region; fall back to espflash's default 24 KB at 0x9000.
/// Custom tables can move settings without code changes.
const NVS_FALLBACK: core::ops::Range<u32> = 0x9000..0xF000;

/// Light settings and the chosen wifi.toml entry, independent records in one log.
const KEY: u8 = 0;
const NETWORK_KEY: u8 = 1;

/// Debounced settings log amortises flash wear over hundreds of records per erase.
pub struct Persist {
	map: MapStorage<
		u8,
		BlockingAsync<FlashStorage<'static>>,
		Cache<Uncached, Uncached, Uncached, u8>,
	>,
	buf: [u8; 48],
}

impl Persist {
	pub fn new(flash: FLASH<'static>) -> Self {
		let mut flash = FlashStorage::new(flash);
		let mut table_buf = [0u8; partitions::PARTITION_TABLE_MAX_LEN];
		let range = read_partition_table(&mut flash, &mut table_buf)
			.ok()
			.and_then(|t| t.find_partition(PartitionType::Data(DataPartitionSubType::Nvs)).ok())
			.flatten()
			.map(|p| p.offset()..p.offset() + p.len())
			.unwrap_or(NVS_FALLBACK);

		Self {
			map: MapStorage::new(
				BlockingAsync::new(flash),
				MapConfig::new(range),
				Cache::new_uncached(),
			),
			buf: [0; 48],
		}
	}

	/// Absent, stale-versioned or corrupt all read as the factory state.
	pub async fn load(&mut self, fallback: LightState) -> LightState {
		match self.map.fetch_item::<[u8; BLOB_LEN]>(&mut self.buf, &KEY).await {
			Ok(Some(blob)) => settings::decode(&blob).unwrap_or(fallback),
			_ => fallback,
		}
	}

	/// Debounce blocking writes, which stall the executor for milliseconds. Save failure must not stop lighting.
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
