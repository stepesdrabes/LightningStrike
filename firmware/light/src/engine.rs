//! Pure standalone/handover state machine, ticked by the board loop.

use crate::api::{Command, Patch, StateDto};
use crate::colour::{lin_rgbw, scale4, widen};
use crate::effects::{fire, twinkle, wash};
use crate::state::{Colour, EffectKind, LightState, Mode, PowerOnPolicy};

const FADE_ON_MS: u64 = 1200;
const FADE_OFF_MS: u64 = 500;
/// Longer than any stall the radio has been measured to produce, so a party cannot end by jitter.
const PARTY_SILENCE_MS: u64 = 2000;
const PARTY_DOWN_MS: u64 = 400;
const PARTY_UP_MS: u64 = 800;
const MUTE_DOWN_MS: u64 = 300;
const RETARGET_MS: u64 = 300;
const SWAP_DOWN_MS: u64 = 250;
const SWAP_UP_MS: u64 = 400;
const IDENTIFY_MS: u64 = 1000;

/// What a command did to the remembered state, so the caller knows when to touch flash.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Save {
	No,
	Debounced,
	Immediate,
}

#[derive(Clone, Copy)]
enum Anim {
	Steady,
	FadeIn { start: u64, ms: u64 },
	FadeOut { start: u64 },
	Retarget { start: u64, from: (Colour, u8) },
	Swap { start: u64, from: EffectKind },
	PartyDown { start: u64 },
	MuteDown { start: u64 },
}

pub struct Engine<const N: usize> {
	remembered: LightState,
	mode: Mode,
	anim: Anim,
	identify_until: Option<u64>,
	last_ddp: Option<u64>,
	/// The stream's last frame, so a party can end by fading what the room actually looked like.
	held: [[u8; 3]; N],
	has_held: bool,
	heat: [u8; N],
	out: [[u16; 4]; N],
	t: u32,
}

impl<const N: usize> Engine<N> {
	pub fn new(now_ms: u64, mut s: LightState) -> Self {
		if s.policy == PowerOnPolicy::AlwaysOn {
			s.on = true;
		}
		Self {
			remembered: s,
			mode: Mode::Smart,
			anim: if s.on { Anim::FadeIn { start: now_ms, ms: FADE_ON_MS } } else { Anim::Steady },
			identify_until: None,
			last_ddp: None,
			held: [[0; 3]; N],
			has_held: false,
			heat: [0; N],
			out: [[0; 4]; N],
			t: 0,
		}
	}

	pub fn mode(&self) -> Mode {
		self.mode
	}

	pub fn settings(&self) -> LightState {
		self.remembered
	}

	/// A data packet arrived; the return says whether its frame belongs on the fixture.
	pub fn on_ddp(&mut self, now_ms: u64) -> bool {
		self.last_ddp = Some(now_ms);
		if self.mode == Mode::Smart {
			self.mode = Mode::Party { muted: false };
			self.anim = Anim::Steady;
		}
		self.mode == (Mode::Party { muted: false }) && self.identify_until.is_none()
	}

	pub fn hold(&mut self, pixels: &[u8]) {
		for (i, px) in self.held.iter_mut().enumerate() {
			let s = i * 3;
			*px = match pixels.get(s..s + 3) {
				Some(c) => [c[0], c[1], c[2]],
				None => [0; 3],
			};
		}
		self.has_held = true;
	}

	pub fn on_command(&mut self, now_ms: u64, cmd: Command) -> Save {
		match cmd {
			Command::Identify => {
				self.identify_until = Some(now_ms + IDENTIFY_MS);
				Save::No
			}
			Command::Patch(p) => self.apply(now_ms, p),
		}
	}

	fn apply(&mut self, now: u64, p: Patch) -> Save {
		let was = self.remembered;
		{
			let s = &mut self.remembered;
			if let Some(v) = p.policy {
				s.policy = v;
			}
			if let Some(v) = p.colour {
				s.colour = v;
			}
			if let Some(v) = p.brightness {
				s.brightness = v;
			}
			if let Some(v) = p.effect {
				s.effect = v;
			}
			if let Some(v) = p.power {
				s.on = v;
			}
		}
		let s = self.remembered;

		match self.mode {
			// Explicit off mutes a party even if the remembered standalone state was already off.
			Mode::Party { muted } => {
				if p.power == Some(false) && !muted {
					self.mode = Mode::Party { muted: true };
					self.anim = Anim::MuteDown { start: now };
				} else if p.power == Some(true) && muted {
					self.mode = Mode::Party { muted: false };
					self.anim = Anim::Steady;
				}
			}
			Mode::Smart => {
				if p.power == Some(true) && !was.on {
					self.anim = Anim::FadeIn { start: now, ms: FADE_ON_MS };
				} else if p.power == Some(false) && was.on {
					self.anim = Anim::FadeOut { start: now };
				} else if s.on {
					if s.effect != was.effect {
						self.anim = Anim::Swap { start: now, from: was.effect };
					} else if s.colour != was.colour || s.brightness != was.brightness {
						self.anim =
							Anim::Retarget { start: now, from: (was.colour, was.brightness) };
					}
				}
			}
		}

		if p.power.is_some() && s.on != was.on {
			Save::Immediate
		} else if s != was {
			Save::Debounced
		} else {
			Save::No
		}
	}

	/// None while the stream owns the fixture; otherwise the frame to show.
	pub fn tick(&mut self, now_ms: u64) -> Option<&[[u16; 4]]> {
		self.t = self.t.wrapping_add(1);

		if let Mode::Party { muted } = self.mode
			&& self.last_ddp.is_some_and(|t| now_ms.saturating_sub(t) > PARTY_SILENCE_MS)
		{
			self.mode = Mode::Smart;
			self.anim = if !muted && self.has_held {
				Anim::PartyDown { start: now_ms }
			} else if self.remembered.on {
				Anim::FadeIn { start: now_ms, ms: PARTY_UP_MS }
			} else {
				Anim::Steady
			};
		}

		if let Some(until) = self.identify_until {
			if now_ms < until {
				self.render_identify(IDENTIFY_MS.saturating_sub(until - now_ms));
				return Some(&self.out);
			}
			self.identify_until = None;
		}

		match self.mode {
			Mode::Party { muted: false } => None,
			Mode::Party { muted: true } => {
				match self.anim {
					Anim::MuteDown { start } if now_ms - start < MUTE_DOWN_MS => {
						self.render_held(falling(now_ms - start, MUTE_DOWN_MS));
					}
					_ => {
						self.anim = Anim::Steady;
						self.render_black();
					}
				}
				Some(&self.out)
			}
			Mode::Smart => {
				self.render_smart(now_ms);
				Some(&self.out)
			}
		}
	}

	pub fn status(&self) -> StateDto {
		let s = self.remembered;
		StateDto {
			power: if s.on { "on" } else { "off" },
			colour: crate::api::HexColour(s.colour),
			brightness: s.brightness,
			effect: s.effect.name(),
			power_on: s.policy.name(),
			mode: match self.mode {
				Mode::Smart => "smart",
				Mode::Party { muted: false } => "party",
				Mode::Party { muted: true } => "party-muted",
			},
		}
	}

	fn render_smart(&mut self, now: u64) {
		let s = self.remembered;
		let tint = lin_rgbw(s.colour.array(), s.brightness);
		match self.anim {
			Anim::Steady => {
				if s.on {
					self.render_effect(s.effect, tint, 65536);
				} else {
					self.render_black();
				}
			}
			Anim::FadeIn { start, ms } => {
				let q = rising(now - start, ms);
				if q == 65536 {
					self.anim = Anim::Steady;
				}
				self.render_effect(s.effect, tint, q);
			}
			Anim::FadeOut { start } => {
				if now - start >= FADE_OFF_MS {
					self.anim = Anim::Steady;
					self.render_black();
				} else {
					self.render_effect(s.effect, tint, falling(now - start, FADE_OFF_MS));
				}
			}
			Anim::Retarget { start, from } => {
				let q = rising(now - start, RETARGET_MS);
				if q == 65536 {
					self.anim = Anim::Steady;
				}
				let a = lin_rgbw(from.0.array(), from.1);
				self.render_effect(s.effect, lerp4(a, tint, q), 65536);
			}
			Anim::Swap { start, from } => {
				let el = now - start;
				if el < SWAP_DOWN_MS {
					self.render_effect(from, tint, falling(el, SWAP_DOWN_MS));
				} else if el < SWAP_DOWN_MS + SWAP_UP_MS {
					self.render_effect(s.effect, tint, rising(el - SWAP_DOWN_MS, SWAP_UP_MS));
				} else {
					self.anim = Anim::Steady;
					self.render_effect(s.effect, tint, 65536);
				}
			}
			Anim::PartyDown { start } => {
				let el = now - start;
				if el >= PARTY_DOWN_MS {
					self.anim = if s.on {
						Anim::FadeIn { start: now, ms: PARTY_UP_MS }
					} else {
						Anim::Steady
					};
					self.render_black();
				} else {
					self.render_held(falling(el, PARTY_DOWN_MS));
				}
			}
			Anim::MuteDown { .. } => {
				self.anim = Anim::Steady;
				self.render_black();
			}
		}
	}

	fn render_effect(&mut self, effect: EffectKind, tint: [u16; 4], env: u32) {
		match effect {
			EffectKind::Wash => wash::render(&mut self.out, scale4(tint, env)),
			EffectKind::Twinkle => self.render_twinkle(tint, env),
			EffectKind::Fire => fire::render(&mut self.out, &mut self.heat, self.t, tint, env),
		}
	}

	/// Blend twinkle halfway toward the tint to retain palette variation.
	fn render_twinkle(&mut self, tint: [u16; 4], env: u32) {
		let level = tint[0].max(tint[1]).max(tint[2]) as u32;
		let gain = ((level * env) >> 16) >> 8;
		for (i, px) in self.out.iter_mut().enumerate() {
			let base = twinkle::twinkle(i as u32, self.t, gain);
			let bl = base[0].max(base[1]).max(base[2]) as u32;
			for k in 0..4 {
				let toward = tint[k] as u32 * bl / 65535;
				px[k] = (base[k] as u32 / 2 + toward / 2) as u16;
			}
		}
	}

	fn render_held(&mut self, q: u32) {
		for (i, px) in self.out.iter_mut().enumerate() {
			let h = self.held[i];
			*px = [
				((widen(h[0]) as u32 * q) >> 16) as u16,
				((widen(h[1]) as u32 * q) >> 16) as u16,
				((widen(h[2]) as u32 * q) >> 16) as u16,
				0,
			];
		}
	}

	fn render_black(&mut self) {
		self.out.fill([0; 4]);
	}

	/// Two pulses at half scale: enough to spot across a room, not a camera flash.
	fn render_identify(&mut self, elapsed: u64) {
		let on = matches!(elapsed, 0..150 | 300..450);
		self.out.fill(if on { [0x8000; 4] } else { [0; 4] });
	}
}

fn rising(elapsed: u64, ms: u64) -> u32 {
	if elapsed >= ms { 65536 } else { (elapsed * 65536 / ms) as u32 }
}

fn falling(elapsed: u64, ms: u64) -> u32 {
	65536 - rising(elapsed, ms)
}

fn lerp4(a: [u16; 4], b: [u16; 4], q: u32) -> [u16; 4] {
	let mut out = [0u16; 4];
	for k in 0..4 {
		let d = b[k] as i64 - a[k] as i64;
		out[k] = (a[k] as i64 + ((d * q as i64) >> 16)) as u16;
	}
	out
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::state::{Colour, EffectKind, LightState, PowerOnPolicy};

	const WHITE: LightState = LightState {
		on: true,
		colour: Colour::new(255, 255, 255),
		brightness: 255,
		effect: EffectKind::Wash,
		policy: PowerOnPolicy::Restore,
	};

	fn off() -> LightState {
		LightState { on: false, ..WHITE }
	}

	fn patch_power(on: bool) -> Command {
		Command::Patch(Patch { power: Some(on), ..Patch::default() })
	}

	#[test]
	fn boot_restore_off_stays_dark() {
		let mut e = Engine::<4>::new(0, off());
		let out = e.tick(25).expect("smart mode always renders");
		assert_eq!(out[0], [0; 4]);
		assert_eq!(e.mode(), Mode::Smart);
	}

	#[test]
	fn boot_always_on_forces_on_in_ram_only() {
		let mut e = Engine::<4>::new(0, LightState { policy: PowerOnPolicy::AlwaysOn, ..off() });
		assert!(e.settings().on);
		let out = e.tick(600).unwrap();
		let mid = out[0][0];
		assert!(mid > 30000 && mid < 35000, "half the fade-in, got {mid}");
		let out = e.tick(1300).unwrap();
		assert_eq!(out[0], [65535; 4]);
	}

	#[test]
	fn wash_full_scale_is_linear_full_scale() {
		let mut e = Engine::<4>::new(0, WHITE);
		let out = e.tick(2000).unwrap();
		assert_eq!(out[0], [65535; 4]);
	}

	#[test]
	fn ddp_enters_party_and_presents() {
		let mut e = Engine::<4>::new(0, off());
		assert!(e.on_ddp(100));
		assert_eq!(e.mode(), Mode::Party { muted: false });
		assert!(e.tick(120).is_none());
	}

	#[test]
	fn silence_fades_held_then_remembered() {
		let mut e = Engine::<4>::new(0, WHITE);
		e.on_ddp(100);
		e.hold(&[200, 100, 50, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
		assert!(e.tick(1000).is_none());

		let out = e.tick(2200).expect("party exit renders the held frame");
		assert_eq!(out[0][0], widen(200), "the fade starts from the frame the room last showed");
		assert_eq!(out[1], [0; 4]);
		assert_eq!(e.mode(), Mode::Smart);
		let out = e.tick(2400).unwrap();
		let mid = out[0][0];
		assert!(mid > 20000 && mid < 30000, "half the held fade, got {mid}");

		e.tick(2700);
		let out = e.tick(3100).unwrap();
		assert!(out[0][0] > 30000 && out[0][0] < 40000, "remembered fading back in");
		let out = e.tick(4000).unwrap();
		assert_eq!(out[0], [65535; 4]);
	}

	#[test]
	fn silence_with_remembered_off_ends_dark() {
		let mut e = Engine::<4>::new(0, off());
		e.on_ddp(100);
		e.hold(&[10; 12]);
		let _ = e.tick(2200);
		let _ = e.tick(2700);
		let out = e.tick(4000).unwrap();
		assert_eq!(out[0], [0; 4]);
	}

	#[test]
	fn off_during_party_mutes_until_turned_on() {
		let mut e = Engine::<4>::new(0, off());
		e.on_ddp(100);
		e.hold(&[10; 12]);
		assert_eq!(e.on_command(200, patch_power(false)), Save::No);
		assert_eq!(e.mode(), Mode::Party { muted: true });
		assert!(!e.on_ddp(300));
		assert!(e.tick(320).is_some(), "muted party renders (the mute fade, then black)");
		let out = e.tick(700).unwrap();
		assert_eq!(out[0], [0; 4]);

		assert_eq!(e.on_command(800, patch_power(true)), Save::Immediate);
		assert!(e.on_ddp(900));
		assert!(e.tick(920).is_none());
	}

	#[test]
	fn patches_during_party_are_silent_but_saved() {
		let mut e = Engine::<4>::new(0, WHITE);
		e.on_ddp(100);
		let cmd = Command::Patch(Patch { colour: Some(Colour::new(1, 2, 3)), ..Patch::default() });
		assert_eq!(e.on_command(200, cmd), Save::Debounced);
		assert!(e.tick(220).is_none(), "the stream still owns the fixture");
		assert_eq!(e.settings().colour, Colour::new(1, 2, 3));
	}

	#[test]
	fn smart_off_fades_out_and_saves_immediately() {
		let mut e = Engine::<4>::new(0, WHITE);
		e.tick(2000);
		assert_eq!(e.on_command(2000, patch_power(false)), Save::Immediate);
		let out = e.tick(2250).unwrap();
		let mid = out[0][0];
		assert!(mid > 30000 && mid < 35000, "half the fade-out, got {mid}");
		let out = e.tick(2600).unwrap();
		assert_eq!(out[0], [0; 4]);
		assert!(!e.settings().on);
	}

	#[test]
	fn retarget_lerps_between_tints() {
		let mut e = Engine::<4>::new(0, WHITE);
		e.tick(2000);
		let cmd = Command::Patch(Patch { brightness: Some(0), ..Patch::default() });
		assert_eq!(e.on_command(2000, cmd), Save::Debounced);
		let out = e.tick(2150).unwrap();
		let mid = out[0][0];
		assert!(mid > 30000 && mid < 35000, "half the lerp, got {mid}");
		let out = e.tick(2400).unwrap();
		assert_eq!(out[0], [0; 4]);
	}

	#[test]
	fn identify_overrides_the_stream_briefly() {
		let mut e = Engine::<4>::new(0, WHITE);
		e.on_ddp(100);
		assert_eq!(e.on_command(200, Command::Identify), Save::No);
		assert!(!e.on_ddp(250));
		let out = e.tick(260).expect("the pulse renders");
		assert_eq!(out[0], [0x8000; 4]);
		let out = e.tick(400).unwrap();
		assert_eq!(out[0], [0; 4], "between pulses");
		assert!(e.tick(1300).is_none(), "identify over, stream resumes");
		assert!(e.on_ddp(1300));
	}

	#[test]
	fn policy_and_effect_patches_save_debounced() {
		let mut e = Engine::<4>::new(0, WHITE);
		e.tick(2000);
		let cmd =
			Command::Patch(Patch { policy: Some(PowerOnPolicy::AlwaysOn), ..Patch::default() });
		assert_eq!(e.on_command(2000, cmd), Save::Debounced);
		let cmd = Command::Patch(Patch { effect: Some(EffectKind::Fire), ..Patch::default() });
		assert_eq!(e.on_command(2100, cmd), Save::Debounced);
		assert_eq!(e.settings().effect, EffectKind::Fire);
	}
}
