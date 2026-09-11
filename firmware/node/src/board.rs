use embassy_rp::Peri;
use embassy_rp::peripherals::{DMA_CH0, DMA_CH1, FLASH, PIN_23, PIN_24, PIN_25, PIN_29, PIO0, USB};

/// Unused fixture peripherals go to radio/console. cyw43 owns PIO0 SM0, DMA_CH0 and GPIO23/24/25/29.
pub struct Board {
	pub usb: Peri<'static, USB>,
	pub pio: Peri<'static, PIO0>,
	pub dma: Peri<'static, DMA_CH0>,
	pub pwr: Peri<'static, PIN_23>,
	pub cs: Peri<'static, PIN_25>,
	pub dio: Peri<'static, PIN_24>,
	pub clk: Peri<'static, PIN_29>,
}

/// The settings store's hardware: DMA_CH1 because cyw43 holds CH0 and the strips CH2 upward.
pub struct Store {
	pub flash: Peri<'static, FLASH>,
	pub dma: Peri<'static, DMA_CH1>,
}
