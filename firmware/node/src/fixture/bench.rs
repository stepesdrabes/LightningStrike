use embassy_rp::Peripherals;
use embassy_rp::peripherals::PIO1;
use embassy_rp::pio::Pio;
use embassy_rp::pio_programs::ws2812::{PioWs2812Program, Rgbw, RgbwPioWs2812};
use embassy_time::{Duration, Timer};
use smart_leds::RGBW;

use crate::board::Board;
use crate::fixture::rgbww::{self, BLACK, LATCH_TOP_UP_US, SLOTS, wire};
use crate::irq::Irqs;

pub const KIND: &str = "sk6812";

/// Addresses on the one data line, which is not the same number as LEDs.
///
/// SK6812 carries its driver inside the 5050 package, one to a LED, so a 5 m reel at 60 LED/m is
/// 300 addresses and cuts every 16.7 mm. A reel that cuts every 50 mm instead is one of the 12 V
/// parts that group three LEDs to a driver, and is 100; the ruler step of [`Fixture::selftest`]
/// says which this is.
///
/// 300 is the permissive error either way. A chain shows the words it has and passes the surplus
/// out of the last IC into open air, so over-counting costs wire time - 12.0 ms against 4.0 ms,
/// 72 per cent of a 60 fps frame against 24 - where under-counting rejects every region the app
/// can point at.
const ADDRESSES: usize = 300;

/// What the shape steps of the selftest run at.
///
/// Deliberately not full scale. Every emitter lit across the whole run is this strip's peak draw,
/// and the first thing a bench rig gets wrong is the wire between the supply and the strip, so
/// the boot pattern stays near a third of it and the peak stays something measured on purpose.
const PROBE: u8 = 96;

/// What the trim pair runs at. Only the ratio between the two frames carries information, so this
/// is chosen to be comfortable rather than to be a maximum.
const TRIM_PROBE: u8 = 160;

/// 5 m of RGBWW on a table, on one data line, before there is a frame to hang it on.
///
/// It exists to answer three things a reel does not come labelled with: which wire byte reaches
/// which emitter, how many LEDs share one address, and how much brighter the white emitter is
/// than the three colour dies. All three are read off the strip by eye during
/// [`Fixture::selftest`], which is why its steps are shapes and counts rather than colours.
///
/// After that it is an ordinary fixture - it joins, receives DDP and runs a real show on 5 m.
/// Point the app's frame device at a **single run** rather than at the whole room: a region
/// larger than this buffer lands past the end of it and lights nothing at all.
pub struct Fixture {
	line: RgbwPioWs2812<'static, PIO1, 0, ADDRESSES, Rgbw>,
	buf: [RGBW<u8>; ADDRESSES],
	idle_t: u32,
}

impl Fixture {
	pub const KIND: &'static str = KIND;
	pub const HOSTNAME: &'static str = "room-bench";
	pub const PIXELS: usize = ADDRESSES;
	/// Three, not four. The host sends the same RGB24 stream every fixture gets and white is
	/// derived here, so what arrives on the wire is unchanged by this strip having a fourth
	/// emitter.
	pub const BYTES: usize = Self::PIXELS * 3;
	pub const IDLE_PERIOD: Duration = Duration::from_millis(25);

	/// GP2 for data, through a level shifter. The Pico drives 3.3 V and this family wants its
	/// logic high referenced to 5 V; without one the strip usually works, which is worse than
	/// failing, because it fails later, intermittently, and looks like a network fault.
	pub fn claim(p: Peripherals) -> (Self, Board) {
		let mut pio = Pio::new(p.PIO1, Irqs);
		let program = PioWs2812Program::new(&mut pio.common);

		// `Rgbw` is the driver's identity packing rather than a claim about this strip: it puts
		// the colour type's four fields on the four byte positions in order, which is what lets
		// [`SLOTS`] be the only place the real order lives.
		let line = RgbwPioWs2812::with_color_order(
			&mut pio.common,
			pio.sm0,
			p.DMA_CH2,
			Irqs,
			p.PIN_2,
			&program,
		);
		let fixture = Self { line, buf: [BLACK; ADDRESSES], idle_t: 0 };

		let board = Board {
			usb: p.USB,
			pio: p.PIO0,
			dma: p.DMA_CH0,
			pwr: p.PIN_23,
			cs: p.PIN_25,
			dio: p.PIN_24,
			clk: p.PIN_29,
		};
		(fixture, board)
	}

	/// Four steps, read off the strip by eye. **Byte order**: byte 0 alone, then 1, 2, 3 - the four
	/// colours in that order are [`SLOTS`], and anything that shifts rather than holding one flat
	/// colour means the strip is three bytes per address. **Density**: bright marks per metre, one
	/// means 100 addresses and three means 300. **Continuity**: one pixel down the run.
	/// **Trim**: full R+G+B, then white alone, same duty, neither trimmed.
	///
	/// The first three write raw bytes rather than emitters, so a wrong `SLOTS` cannot make them
	/// unreadable.
	pub async fn selftest(&mut self) {
		for byte in 0..4 {
			let mut bytes = [0u8; 4];
			bytes[byte] = PROBE;
			self.buf.fill(wire(bytes));
			self.write().await;
			Timer::after_millis(1500).await;
		}

		self.buf.fill(BLACK);
		for i in (0..ADDRESSES).step_by(5) {
			self.buf[i] = if i % 20 == 0 { wire([PROBE; 4]) } else { wire([PROBE, 0, 0, 0]) };
		}
		self.write().await;
		Timer::after_millis(4000).await;

		let steps = 40;
		for step in 0..=steps {
			self.buf.fill(BLACK);
			self.buf[step * (ADDRESSES - 1) / steps] = wire([PROBE; 4]);
			self.write().await;
			Timer::after_millis(30).await;
		}

		for emitters in [[TRIM_PROBE, TRIM_PROBE, TRIM_PROBE, 0], [0, 0, 0, TRIM_PROBE]] {
			let mut bytes = [0u8; 4];
			for (i, &level) in emitters.iter().enumerate() {
				bytes[SLOTS[i]] = level;
			}
			self.buf.fill(wire(bytes));
			self.write().await;
			Timer::after_millis(1500).await;
		}

		self.blank().await;
	}

	/// What the strip shows while nothing is streaming at it, one frame per call.
	pub async fn idle(&mut self) {
		self.idle_t = self.idle_t.wrapping_add(1);
		let gain = (self.idle_t.min(rgbww::FADE) * 256 / rgbww::FADE).min(256);
		rgbww::twinkle(&mut self.buf, self.idle_t, gain, 0);
		self.write().await;
	}

	pub async fn idle_forever(&mut self) -> ! {
		loop {
			self.idle().await;
			Timer::after(Self::IDLE_PERIOD).await;
		}
	}

	/// Bytes straight from the wire. The host owns gamma, so nothing here rescales them.
	pub async fn present(&mut self, pixels: &[u8]) {
		self.idle_t = 0;
		rgbww::unpack(pixels, &mut self.buf);
		self.write().await;
	}

	/// A second with no frame in it. Without this the strip holds the last frame of a stopped
	/// show for as long as the board has power, which looks exactly like one still running.
	pub async fn blank(&mut self) {
		self.buf.fill(BLACK);
		self.write().await;
	}

	async fn write(&mut self) {
		self.line.write(&self.buf).await;
		Timer::after_micros(LATCH_TOP_UP_US).await;
	}
}
