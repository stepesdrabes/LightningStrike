use embassy_time::Duration;
#[cfg(feature = "selftest")]
use embassy_time::Timer;
use esp_hal::gpio::DriveMode;
use esp_hal::gpio::interconnect::PeripheralOutput;
use esp_hal::ledc::channel::{self, ChannelHW, ChannelIFace};
use esp_hal::ledc::timer::{self, TimerIFace};
use esp_hal::ledc::{LSGlobalClkSource, Ledc, LowSpeed};
use esp_hal::peripherals::{GPIO3, GPIO4, GPIO5, GPIO6, LEDC};
use esp_hal::time::Rate;
use room_light::state::{Colour, EffectKind, LightState, PowerOnPolicy};
use static_cell::StaticCell;

pub const KIND: &str = "lamp";

/// 13 bits is the LEDC ceiling at this frequency (80 MHz APB), and still 32x finer than the
/// strip's own drivers; wire values are 16-bit, shifted down at the last step.
const MAX_DUTY: u32 = (1 << 13) - 1;

/// Per-channel scale, 256 unity. White starts at a quarter because the strip's two phosphor
/// emitters outrun the three colour dies several times over; the selftest's last two steps show
/// the real ratio. Err low, and pull this channel down first if the supply is short.
const TRIM: [u32; 4] = [256, 256, 256, 64];

/// The Bounce Lamp on its own brain: one pixel on an analog RGBW strip, four low-side MOSFET
/// gates on LEDC PWM. R GPIO3, G GPIO4, B GPIO5, W GPIO6 - the C3's strapping pins 2, 8 and 9
/// stay untouched, and a wrong colour order is a moved wire, which `--features selftest` shows.
pub struct Fixture {
	r: channel::Channel<'static, LowSpeed>,
	g: channel::Channel<'static, LowSpeed>,
	b: channel::Channel<'static, LowSpeed>,
	w: channel::Channel<'static, LowSpeed>,
	last: (u16, u16, u16, u16),
}

pub struct Pins {
	pub ledc: LEDC<'static>,
	pub r: GPIO3<'static>,
	pub g: GPIO4<'static>,
	pub b: GPIO5<'static>,
	pub w: GPIO6<'static>,
}

impl Fixture {
	pub const KIND: &'static str = KIND;
	pub const HOSTNAME: &'static str = "room-bounce";
	pub const PIXELS: usize = 1;
	pub const BYTES: usize = Self::PIXELS * 3;
	/// PWM writes are cheap and 30 Hz is plenty for a fade.
	pub const ENGINE_PERIOD: Duration = Duration::from_millis(33);
	/// AlwaysOn, because this lamp lives on a wall switch and flipping it must make light.
	pub const DEFAULTS: LightState = LightState {
		on: true,
		colour: Colour::new(255, 214, 170),
		brightness: 200,
		effect: EffectKind::Wash,
		policy: PowerOnPolicy::AlwaysOn,
	};
	/// One pixel is a wash by definition; scattering effects need somewhere to scatter.
	pub const EFFECTS: &'static [EffectKind] = &[EffectKind::Wash];

	pub fn claim(pins: Pins) -> Self {
		static LEDC_CELL: StaticCell<Ledc<'static>> = StaticCell::new();
		static TIMER_CELL: StaticCell<timer::Timer<'static, LowSpeed>> = StaticCell::new();

		let ledc = LEDC_CELL.init(Ledc::new(pins.ledc));
		ledc.set_global_slow_clock(LSGlobalClkSource::APBClk);

		// About 1.9 kHz, like the Pico build: above flicker, far from the frame rate. If low
		// duties read non-linear, lower this rather than TRIM; the RC slew limiter on each gate
		// is the suspect.
		let lstimer = TIMER_CELL.init(ledc.timer::<LowSpeed>(timer::Number::Timer0));
		lstimer
			.configure(timer::config::Config {
				duty: timer::config::Duty::Duty13Bit,
				clock_source: timer::LSClockSource::APBClk,
				frequency: Rate::from_hz(1900),
			})
			.unwrap();

		fn chan(
			ledc: &'static Ledc<'static>,
			lstimer: &'static timer::Timer<'static, LowSpeed>,
			number: channel::Number,
			pin: impl PeripheralOutput<'static>,
		) -> channel::Channel<'static, LowSpeed> {
			let mut ch = ledc.channel::<LowSpeed>(number, pin);
			ch.configure(channel::config::Config {
				timer: lstimer,
				duty_pct: 0,
				drive_mode: DriveMode::PushPull,
			})
			.unwrap();
			ch
		}

		Self {
			r: chan(ledc, lstimer, channel::Number::Channel0, pins.r),
			g: chan(ledc, lstimer, channel::Number::Channel1, pins.g),
			b: chan(ledc, lstimer, channel::Number::Channel2, pins.b),
			w: chan(ledc, lstimer, channel::Number::Channel3, pins.w),
			last: (0, 0, 0, 0),
		}
	}

	/// Off by default, so the boot look is the engine's fade into the remembered state and a
	/// power cut is not announced to the room. `--features selftest` plays R, G, B, then R+G+B and
	/// W alone, half a second each: the first three say which gate is which, and the last two are
	/// the [`TRIM`] measurement at raw duty, so a wrong trim cannot hide a wiring fault.
	pub async fn selftest(&mut self) {
		#[cfg(feature = "selftest")]
		{
			const ON: u16 = u16::MAX;
			for (r, g, b, w) in
				[(ON, 0, 0, 0), (0, ON, 0, 0), (0, 0, ON, 0), (ON, ON, ON, 0), (0, 0, 0, ON)]
			{
				self.write_raw(r, g, b, w);
				Timer::after_millis(500).await;
			}
			self.write_raw(0, 0, 0, 0);
		}
	}

	/// The engine's one pixel, linear RGBW with the white already derived; only the trim is
	/// applied here.
	pub async fn show(&mut self, out: &[[u16; 4]]) {
		let Some(px) = out.first() else {
			return;
		};
		self.write(
			trim16(px[0], TRIM[0]),
			trim16(px[1], TRIM[1]),
			trim16(px[2], TRIM[2]),
			trim16(px[3], TRIM[3]),
		);
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
			trim16(widen(px[0]), TRIM[0]),
			trim16(widen(px[1]), TRIM[1]),
			trim16(widen(px[2]), TRIM[2]),
			trim16(widen(white), TRIM[3]),
		);
	}

	fn write(&mut self, r: u16, g: u16, b: u16, w: u16) {
		if (r, g, b, w) == self.last {
			return;
		}
		self.last = (r, g, b, w);
		self.write_raw(r, g, b, w);
	}

	fn write_raw(&self, r: u16, g: u16, b: u16, w: u16) {
		self.r.set_duty_hw(duty(r));
		self.g.set_duty_hw(duty(g));
		self.b.set_duty_hw(duty(b));
		self.w.set_duty_hw(duty(w));
	}
}

/// Trim is applied last so it can only pull a channel down.
fn trim16(value: u16, trim: u32) -> u16 {
	((value as u32 * trim) >> 8).min(u16::MAX as u32) as u16
}

fn widen(b: u8) -> u16 {
	(b as u16) << 8 | b as u16
}

fn duty(value: u16) -> u32 {
	value as u32 * MAX_DUTY / u16::MAX as u32
}
