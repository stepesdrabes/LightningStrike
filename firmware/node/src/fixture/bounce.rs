use embassy_rp::Peripherals;
use embassy_rp::pwm::{Config as PwmConfig, Pwm};
use embassy_time::{Duration, Timer};
use embedded_hal::pwm::SetDutyCycle;

use crate::board::Board;

pub const KIND: &str = "lamp";

/// Duty a full-scale pixel gets, out of 65535. A diffused strip seen across a room is a wash, so
/// its ceiling is its own maximum.
const MAX_DUTY: u32 = 65535;

/// Per-channel scale, 256 unity. White starts at a quarter because the strip's two phosphor
/// emitters outrun the three colour dies several times over; the last two selftest steps show the
/// real ratio. Err low, since too much white destroys every pastel in the show. Full white is
/// also this strip's peak draw, so this is the channel to pull down if the supply is short.
const TRIM: [u32; 4] = [256, 256, 256, 64];

/// The Bounce Lamp: one pixel on an analog RGBW strip, four low-side MOSFET gates on PWM.
/// R GP6, G GP7, B GP8, W GP9, ground on physical 13. The beat and passage envelopes live on the
/// host in `packages/core/src/bounce.ts`, which can see `kickEnv` where this could only guess.
pub struct Fixture {
	rg: Pwm<'static>,
	bw: Pwm<'static>,
	last: (u16, u16, u16, u16),
}

impl Fixture {
	pub const KIND: &'static str = KIND;
	pub const HOSTNAME: &'static str = "room-bounce";
	pub const PIXELS: usize = 1;
	pub const BYTES: usize = Self::PIXELS * 3;
	pub const IDLE_PERIOD: Duration = Duration::from_millis(500);

	/// PWM slices 3 and 4; cyw43 wants no PWM at all.
	pub fn claim(p: Peripherals) -> (Self, Board) {
		// The default top and divider give about 1.9 kHz: above flicker and far from 60 Hz, so it
		// cannot beat with the frame rate. If low duties read non-linear, lower this rather than
		// TRIM; the RC slew limiter on each gate is the suspect.
		let cfg = PwmConfig::default();
		let fixture = Self {
			rg: Pwm::new_output_ab(p.PWM_SLICE3, p.PIN_6, p.PIN_7, cfg.clone()),
			bw: Pwm::new_output_ab(p.PWM_SLICE4, p.PIN_8, p.PIN_9, cfg),
			// The config starts at compare 0, so skipping a first write of black is correct.
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

	/// R, G, B, then R+G+B and W alone, half a second each. The first three say which gate is
	/// which; the last two are the [`TRIM`] measurement, at raw duty so a wrong trim cannot hide
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

	/// White is the achromatic part added to the colour, not moved out of it: subtracting only
	/// holds when the white emitter shares a white point with the RGB mix, and a warm phosphor
	/// does not. Adding cannot shift a hue.
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

	/// Dark, not a twinkle: a lamp in peripheral vision scintillating is a distraction.
	pub async fn idle(&mut self) {
		self.blank().await;
	}

	pub async fn idle_forever(&mut self) -> ! {
		self.blank().await;
		core::future::pending().await
	}

	pub async fn blank(&mut self) {
		self.write(0, 0, 0, 0);
	}

	/// Compare registers only, so the output stays clean across a mid-period change.
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

/// Trim is applied last so it can only pull a channel down.
fn scale(value: u8, trim: u32) -> u16 {
	let duty = value as u32 * MAX_DUTY / 255;
	((duty as u64 * trim as u64) >> 8).min(u16::MAX as u64) as u16
}
