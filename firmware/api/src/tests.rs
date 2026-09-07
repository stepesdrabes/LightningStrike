extern crate std;

use core::future::Future;
use core::pin::pin;
use core::task::{Context, Poll, Waker};
use std::string::String;
use std::vec::Vec;

use embedded_io_async::{ErrorType, Read, Write};
use room_light::api::{HexColour, InfoDto, Patch, StateDto};
use room_light::state::{Colour, EffectKind};

use super::{Api, serve};

/// The mocks never yield, so a pending poll is a bug rather than a wait.
fn block_on<F: Future>(f: F) -> F::Output {
	let mut f = pin!(f);
	let mut cx = Context::from_waker(Waker::noop());
	match f.as_mut().poll(&mut cx) {
		Poll::Ready(v) => v,
		Poll::Pending => panic!("mock io pended"),
	}
}

struct MockConn<'a> {
	input: &'a [&'a [u8]],
	chunk: usize,
	output: Vec<u8>,
}

impl<'a> MockConn<'a> {
	fn new(input: &'a [&'a [u8]]) -> Self {
		Self { input, chunk: 0, output: Vec::new() }
	}

	fn response(&self) -> &str {
		core::str::from_utf8(&self.output).unwrap()
	}
}

impl ErrorType for MockConn<'_> {
	type Error = core::convert::Infallible;
}

impl Read for MockConn<'_> {
	async fn read(&mut self, buf: &mut [u8]) -> Result<usize, Self::Error> {
		let Some(chunk) = self.input.get(self.chunk) else {
			return Ok(0);
		};
		self.chunk += 1;
		let n = chunk.len().min(buf.len());
		buf[..n].copy_from_slice(&chunk[..n]);
		Ok(n)
	}
}

impl Write for MockConn<'_> {
	async fn write(&mut self, buf: &[u8]) -> Result<usize, Self::Error> {
		self.output.extend_from_slice(buf);
		Ok(buf.len())
	}

	async fn flush(&mut self) -> Result<(), Self::Error> {
		Ok(())
	}
}

struct MockApi {
	applied: Vec<Patch>,
	identified: usize,
}

impl MockApi {
	fn new() -> Self {
		Self { applied: Vec::new(), identified: 0 }
	}

	fn dto(&self) -> StateDto {
		StateDto {
			power: "on",
			colour: HexColour(Colour::new(0xff, 0xb4, 0x6e)),
			brightness: 160,
			effect: "twinkle",
			power_on: "restore",
			mode: "smart",
		}
	}
}

impl Api for MockApi {
	fn effects(&self) -> &'static [EffectKind] {
		&EffectKind::ALL
	}

	fn info(&self) -> InfoDto<'static> {
		InfoDto {
			name: "room-frame",
			ip: "192.168.1.57",
			firmware: "0.2.0",
			uptime_s: 42,
			pixels: 720,
			ddp_port: 4048,
			stats_port: 4049,
			leds: "sk6812",
			effects: &EffectKind::ALL,
		}
	}

	async fn state(&mut self) -> StateDto {
		self.dto()
	}

	async fn apply(&mut self, patch: Patch) -> StateDto {
		self.applied.push(patch);
		self.dto()
	}

	async fn identify(&mut self) {
		self.identified += 1;
	}
}

fn run(api: &mut MockApi, input: &[&[u8]]) -> String {
	let mut conn = MockConn::new(input);
	block_on(serve(&mut conn, api)).unwrap();
	String::from(conn.response())
}

#[test]
fn get_state() {
	let mut api = MockApi::new();
	let res = run(&mut api, &[b"GET /api/state HTTP/1.1\r\nHost: x\r\n\r\n"]);
	assert!(res.starts_with("HTTP/1.1 200 OK\r\n"), "{res}");
	assert!(res.contains("Connection: close"), "{res}");
	assert!(res.ends_with(r##"{"power":"on","colour":"#ffb46e","brightness":160,"effect":"twinkle","powerOn":"restore","mode":"smart"}"##), "{res}");
}

#[test]
fn post_state_applies_and_echoes() {
	let mut api = MockApi::new();
	let body = br#"{"power":"off","brightness":40}"#;
	let mut req =
		std::format!("POST /api/state HTTP/1.1\r\nContent-Length: {}\r\n\r\n", body.len());
	req.push_str(core::str::from_utf8(body).unwrap());
	let res = run(&mut api, &[req.as_bytes()]);
	assert!(res.starts_with("HTTP/1.1 200"), "{res}");
	assert_eq!(api.applied.len(), 1);
	assert_eq!(api.applied[0].power, Some(false));
	assert_eq!(api.applied[0].brightness, Some(40));
}

#[test]
fn post_state_in_two_chunks() {
	let mut api = MockApi::new();
	let res = run(
		&mut api,
		&[b"POST /api/state HTTP/1.1\r\nContent-Le", b"ngth: 15\r\n\r\n{\"power\":\"on\"}X"],
	);
	// 15 covers the body and one stray byte the parser must not read past.
	assert!(res.starts_with("HTTP/1.1 400"), "trailing garbage fails the json: {res}");

	let mut api = MockApi::new();
	let res = run(
		&mut api,
		&[b"POST /api/state HTTP/1.1\r\nContent-Le", b"ngth: 14\r\n\r\n{\"power\":\"on\"}"],
	);
	assert!(res.starts_with("HTTP/1.1 200"), "{res}");
	assert_eq!(api.applied[0].power, Some(true));
}

#[test]
fn post_state_validation_errors() {
	let mut api = MockApi::new();
	let body = br#"{"brightness":300}"#;
	let req = std::format!(
		"POST /api/state HTTP/1.1\r\nContent-Length: {}\r\n\r\n{}",
		body.len(),
		core::str::from_utf8(body).unwrap()
	);
	let res = run(&mut api, &[req.as_bytes()]);
	assert!(res.starts_with("HTTP/1.1 400"), "{res}");
	assert!(res.contains(r#"{"error":"brightness 0..255"}"#), "{res}");
	assert!(api.applied.is_empty());
}

#[test]
fn post_without_length_is_411() {
	let mut api = MockApi::new();
	let res = run(&mut api, &[b"POST /api/state HTTP/1.1\r\n\r\n"]);
	assert!(res.starts_with("HTTP/1.1 411"), "{res}");
}

#[test]
fn identify_is_204() {
	let mut api = MockApi::new();
	let res = run(&mut api, &[b"POST /api/identify HTTP/1.1\r\nContent-Length: 0\r\n\r\n"]);
	assert!(res.starts_with("HTTP/1.1 204"), "{res}");
	assert_eq!(api.identified, 1);
}

#[test]
fn info_carries_the_effects() {
	let mut api = MockApi::new();
	let res = run(&mut api, &[b"GET /api/info HTTP/1.1\r\n\r\n"]);
	assert!(res.starts_with("HTTP/1.1 200"), "{res}");
	assert!(res.contains(r#""effects":["wash","twinkle","fire"]"#), "{res}");
	assert!(res.contains(r#""ddpPort":4048"#), "{res}");
	// What the controller derives a subnet from when it was opened at a `.local` name.
	assert!(res.contains(r#""ip":"192.168.1.57""#), "{res}");
}

/// The header the whole two-way controller rests on. The app is served from elsewhere on the
/// network, so every request it makes is cross-origin; without this a browser may send but never
/// read, which is the flaw the app was rebuilt to fix.
#[test]
fn cors_is_on_every_response() {
	let mut api = MockApi::new();
	for req in [
		&b"GET /api/state HTTP/1.1\r\n\r\n"[..],
		&b"GET /api/info HTTP/1.1\r\n\r\n"[..],
		&b"GET /nope HTTP/1.1\r\n\r\n"[..],
	] {
		let res = run(&mut api, &[req]);
		assert!(res.contains("Access-Control-Allow-Origin: *"), "{res}");
	}
}

#[test]
fn preflight_is_answered_on_any_path() {
	let mut api = MockApi::new();
	for path in ["/api/state", "/api/identify", "/whatever"] {
		let req = std::format!("OPTIONS {path} HTTP/1.1\r\n\r\n");
		let res = run(&mut api, &[req.as_bytes()]);
		assert!(res.starts_with("HTTP/1.1 204"), "{path}: {res}");
		assert!(res.contains("Access-Control-Allow-Headers: content-type"), "{path}: {res}");
	}
}

#[test]
fn unknown_path_and_wrong_method() {
	let mut api = MockApi::new();
	let res = run(&mut api, &[b"GET /nope HTTP/1.1\r\n\r\n"]);
	assert!(res.starts_with("HTTP/1.1 404"), "{res}");
	let res = run(&mut api, &[b"GET /api/identify HTTP/1.1\r\n\r\n"]);
	assert!(res.starts_with("HTTP/1.1 405"), "{res}");
	let res = run(&mut api, &[b"POST /api/info HTTP/1.1\r\n\r\n"]);
	assert!(res.starts_with("HTTP/1.1 405"), "{res}");
}
