use embassy_rp::Peripherals;
use embassy_rp::pwm::{Config as PwmConfig, Pwm};
use embassy_time::{Duration, Timer};
use embedded_hal::pwm::SetDutyCycle;

use crate::board::Board;

pub const KIND: &str = "lamp";

/// Duty a full-scale pixel gets, out of 65535.
///
/// Full scale, because nothing about this fixture argues for less: a diffused column seen across
/// a room is a wash, and its ceiling is its own maximum. Pull it down if the strip is
/// uncomfortable outside the housing it came from, or if the supply cannot hold 12 V.
const MAX_DUTY: u32 = 65535;

/// Per-channel scale for the fixture, 256 being unity.
///
/// White is the channel that needs it, and this strip is a bad case: two phosphor emitters to
/// every RGB package and each of them brighter than a single die, so the white channel outruns
/// the other three several times over and equal duty is nowhere near equal light. Left at unity
/// it swamps every desaturated colour and the lamp reads as a warm bulb rather than as the room.
///
/// A quarter is a starting point, not a measurement. The last two steps of [`Fixture::selftest`]
/// are the measurement: full R+G+B, then full W, at raw duty with no trim applied. Set this near
/// the ratio between them and **err low** - too little white costs a washed out frame some punch,
/// where too much destroys the hue of every pastel in the show.
///
/// It is also where the current limit lives. Additive white lights all four channels at once,
/// which is the most this strip can draw; measure it on a full white frame before leaving the
/// lamp running unattended.
const TRIM: [u32; 4] = [256, 256, 256, 64];

/// The Bounce Lamp: a one-pixel fixture on an analog RGBW strip, four MOSFET gates on PWM.
///
/// Every LED on the strip shows the same thing, so what arrives is one pixel and this only has to
/// put it on four channels. The envelopes that used to live here - the beat, the passage, the
/// floor - are the host's now: it can see `kickEnv` where the board could only ever infer a beat
/// from how much of the room happened to be lit, and smoothing on both sides smooths twice.
///
/// Common anode at 12 V, one low-side switch per channel:
///
/// ```text
///   R GP6   G GP7   B GP8   W GP9     physical 9, 10, 11, 12, ground at 13
/// ```
pub struct Fixture {
	/// Red on channel A, green on channel B.
	rg: Pwm<'static>,
	/// Blue on channel A, white on channel B.
	bw: Pwm<'static>,
	last: (u16, u16, u16, u16),
}

impl Fixture {
	pub const KIND: &'static str = KIND;
	pub const HOSTNAME: &'static str = "room-bounce";
	pub const PIXELS: usize = 1;
	pub const BYTES: usize = Self::PIXELS * 3;
	pub const IDLE_PERIOD: Duration = Duration::from_millis(500);

	/// Slices 3 and 4, which nothing else wants: cyw43 holds PIO0 SM0, DMA_CH0 and GPIO 23, 24,
	/// 25 and 29, and wants no PWM at all.
	pub fn claim(p: Peripherals) -> (Self, Board) {
		// Default top and divider are 16 bits at 125 MHz / 65536, about 1.9 kHz. Far enough above
		// the eye not to flicker and nowhere near 60 Hz, so it cannot beat with the frame rate and
		// invent a throb that is not in the show. If low duty cycles read non-linear or the lamp
		// will not go fully dark, suspect the RC slew limiter on each gate and lower this rather
		// than reaching for TRIM.
		let cfg = PwmConfig::default();
		let fixture = Self {
			rg: Pwm::new_output_ab(p.PWM_SLICE3, p.PIN_6, p.PIN_7, cfg.clone()),
			bw: Pwm::new_output_ab(p.PWM_SLICE4, p.PIN_8, p.PIN_9, cfg),
			// Matches the zero compare the config above starts at, so the first real write is
			// never skipped as a no-op.
			last: (0, 0, 0, 0),
		};

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

	/// Red, green, blue, then both whites, half a second each, before the radio is even up.
	///
	/// The first three answer a question the firmware cannot: which gate is which channel. A
	/// swapped pair is indistinguishable from the show being wrong, because both look like the
	/// right light at the wrong time in the wrong colour, and if the order that lights is not red,
	/// green, blue then the fault is in the four wires and nothing further up is worth reading.
	///
	/// The last two are the [`TRIM`] measurement, and they are adjacent so the eye can compare
	/// them: **R+G+B together, then W alone**. Raw duty with no trim applied, because trim is what
	/// the difference between them is for, and because a badly wrong trim must not be able to hide
	/// a wiring fault.
	pub async fn selftest(&mut self) {
		const ON: u16 = u16::MAX;
		for (r, g, b, w) in
			[(ON, 0, 0, 0), (0, ON, 0, 0), (0, 0, ON, 0), (ON, ON, ON, 0), (0, 0, 0, ON)]
		{
			self.write(r, g, b, w);
			Timer::after_millis(500).await;
		}
		self.write(0, 0, 0, 0);
	}

	/// One pixel, on four channels.
	///
	/// White is the frame's achromatic part **added** to the colour rather than subtracted from
	/// it. Subtracting is the textbook conversion and more efficient, but it only holds when the
	/// white emitter shares a white point with the RGB mix, and a warm phosphor against a 6000 K
	/// mix does not: every mid-saturation colour would shift toward the white LED's own tint.
	/// Adding cannot shift a hue, because a saturated frame has no achromatic part to add.
	pub async fn present(&mut self, pixels: &[u8]) {
		let Some(px) = pixels.get(..3) else {
			return;
		};
		let white = px[0].min(px[1]).min(px[2]);
		self.write(
			scale(px[0], TRIM[0]),
			scale(px[1], TRIM[1]),
			scale(px[2], TRIM[2]),
			scale(white, TRIM[3]),
		);
	}

	/// Dark, not a twinkle. This lamp sits in peripheral vision, which is markedly more
	/// flicker-sensitive than the fovea, and a scintillating corner is a distraction rather than a
	/// welcome.
	pub async fn idle(&mut self) {
		self.blank().await;
	}

	pub async fn idle_forever(&mut self) -> ! {
		self.blank().await;
		core::future::pending().await
	}

	/// A second with no frame in it. Without this the lamp holds the last frame of a stopped show
	/// for as long as the board has power, which looks exactly like one still running.
	pub async fn blank(&mut self) {
		self.write(0, 0, 0, 0);
	}

	/// Compare registers only, leaving the running counter alone so the output stays clean across
	/// a mid-period change.
	fn write(&mut self, r: u16, g: u16, b: u16, w: u16) {
		if (r, g, b, w) == self.last {
			return;
		}
		self.last = (r, g, b, w);

		let (chan_r, chan_g) = self.rg.split_by_ref();
		if let Some(mut c) = chan_r {
			let _ = c.set_duty_cycle(r);
		}
		if let Some(mut c) = chan_g {
			let _ = c.set_duty_cycle(g);
		}

		let (chan_b, chan_w) = self.bw.split_by_ref();
		if let Some(mut c) = chan_b {
			let _ = c.set_duty_cycle(b);
		}
		if let Some(mut c) = chan_w {
			let _ = c.set_duty_cycle(w);
		}
	}
}

/// One channel of the wire's byte to a PWM compare value, with wiring correction applied last so
/// it can only pull a channel down out of a value that already carries the show's own level.
fn scale(value: u8, trim: u32) -> u16 {
	let duty = value as u32 * MAX_DUTY / 255;
	((duty as u64 * trim as u64) >> 8).min(u16::MAX as u64) as u16
}
