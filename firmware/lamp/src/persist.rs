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

/// espflash's default table puts `nvs` at 0x9000, 24 KB; nothing else touches it in a
/// bare-metal app, so it is the settings store. Read from the table anyway, so a custom table
/// moves it without a code change.
const NVS_FALLBACK: core::ops::Range<u32> = 0x9000..0xF000;

const KEY: u8 = 0;

/// The remembered light in flash; same wear maths as the Pico build, hundreds of records per
/// erase cycle against debounced saves.
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

	/// Best effort: a light that cannot save is still a light. The blocking write stalls the
	/// executor for a few ms, which is why saves are debounced rather than per-change.
	pub async fn save(&mut self, s: &LightState) {
		if let Err(e) = self.map.store_item(&mut self.buf, &KEY, &settings::encode(s)).await {
			log::warn!("settings save failed: {e:?}");
		}
	}
}
