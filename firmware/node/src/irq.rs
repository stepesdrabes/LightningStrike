use embassy_rp::peripherals::{DMA_CH0, DMA_CH1, PIO0, USB};
use embassy_rp::pio::InterruptHandler as PioIrq;
use embassy_rp::usb::InterruptHandler as UsbIrq;
use embassy_rp::{bind_interrupts, dma};

#[cfg(feature = "strips")]
use embassy_rp::peripherals::{DMA_CH2, PIO1};
#[cfg(feature = "frame")]
use embassy_rp::peripherals::{DMA_CH3, DMA_CH4};

// All RP2040 DMA channels share DMA_IRQ_0; add strip handlers to that vector. CH1 serves settings flash.
bind_interrupts!(pub struct Irqs {
	PIO0_IRQ_0 => PioIrq<PIO0>;
	#[cfg(feature = "strips")]
	PIO1_IRQ_0 => PioIrq<PIO1>;
	DMA_IRQ_0 => dma::InterruptHandler<DMA_CH0>,
		dma::InterruptHandler<DMA_CH1>,
		#[cfg(feature = "strips")] dma::InterruptHandler<DMA_CH2>,
		#[cfg(feature = "frame")] dma::InterruptHandler<DMA_CH3>,
		#[cfg(feature = "frame")] dma::InterruptHandler<DMA_CH4>;
	USBCTRL_IRQ => UsbIrq<USB>;
});
