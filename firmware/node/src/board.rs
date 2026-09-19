use embassy_rp::Peri;
use embassy_rp::flash::{Async, Flash};
use embassy_rp::peripherals::{
	DMA_CH0, DMA_CH1, FLASH, PIN_18, PIN_23, PIN_24, PIN_25, PIN_29, PIO0, USB, WATCHDOG,
};
use embassy_sync::blocking_mutex::raw::NoopRawMutex;
use embassy_sync::mutex::Mutex;

/// The whole chip. Every partition indexes into it by offset, so they all share this size.
const FLASH_SIZE: usize = 2 * 1024 * 1024;

pub type Nvs = Flash<'static, FLASH, Async, FLASH_SIZE>;

/// One flash peripheral, lent to the settings store and to the spare slot. Both live on the
/// same executor, so the lock is uncontended bookkeeping rather than a real wait.
pub type SharedFlash = Mutex<NoopRawMutex, Nvs>;

/// Unused fixture peripherals go to radio/console. cyw43 owns PIO0 SM0, DMA_CH0 and GPIO23/24/25/29.
pub struct Board {
	pub usb: Peri<'static, USB>,
	pub pio: Peri<'static, PIO0>,
	pub dma: Peri<'static, DMA_CH0>,
	pub pwr: Peri<'static, PIN_23>,
	pub cs: Peri<'static, PIN_25>,
	pub dio: Peri<'static, PIN_24>,
	pub clk: Peri<'static, PIN_29>,
	/// The network-select button, which is why it travels with the radio.
	pub button: Peri<'static, PIN_18>,
}

/// The board's own housekeeping, as opposed to the fixture's or the radio's. DMA_CH1 because
/// cyw43 holds CH0 and the strips CH2 upward.
pub struct Store {
	pub flash: Peri<'static, FLASH>,
	pub dma: Peri<'static, DMA_CH1>,
	/// Already running: the bootloader starts it before handing over.
	pub watchdog: Peri<'static, WATCHDOG>,
}
