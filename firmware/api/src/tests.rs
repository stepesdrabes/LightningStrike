extern crate std;

use core::future::Future;
use core::pin::pin;
use core::task::{Context, Poll, Waker};
use std::string::String;
use std::vec::Vec;

use embedded_io_async::{ErrorType, Read, Write};
use room_light::api::{HexColour, InfoDto, Patch, StateDto};
use room_light::state::{Colour, EffectKind};

use super::{Api, OtaError, Served, serve};

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
	/// How far into the current chunk a short read has got. A firmware image is longer than
	/// any single read, so a chunk has to survive being taken in pieces.
	offset: usize,
	output: Vec<u8>,
}

impl<'a> MockConn<'a> {
	fn new(input: &'a [&'a [u8]]) -> Self {
		Self { input, chunk: 0, offset: 0, output: Vec::new() }
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
		let rest = &chunk[self.offset..];
		let n = rest.len().min(buf.len());
		buf[..n].copy_from_slice(&rest[..n]);
		self.offset += n;
		if self.offset == chunk.len() {
			self.chunk += 1;
			self.offset = 0;
		}
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

	fn info(&self) -> InfoDto<'_> {
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

fn run_ota(api: &mut MockOta, input: &[&[u8]]) -> (String, Served) {
	let mut conn = MockConn::new(input);
	let served = block_on(serve(&mut conn, api)).unwrap();
	(String::from(conn.response()), served)
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
	// The prefix, not the whole list: adding an effect is not a regression in this route.
	assert!(res.contains(r#""effects":["wash","twinkle","fire""#), "{res}");
	assert!(res.contains(r#""ddpPort":4048"#), "{res}");
	// What the controller derives a subnet from when it was opened at a `.local` name.
	assert!(res.contains(r#""ip":"192.168.1.57""#), "{res}");
}

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

/// A board with a spare slot, modelling the interlock as well as the bytes: `busy` is what
/// serialises two listeners on the real board, so a mock without it cannot show the bug.
struct MockOta {
	base: MockApi,
	capacity: usize,
	busy: bool,
	/// Bytes taken since `begin`. None means the slot was never claimed.
	staging: Option<Vec<u8>>,
	expected: usize,
	/// The image as it stood when it was marked bootable.
	committed: Option<Vec<u8>>,
	aborts: usize,
	/// Makes `begin` refuse, standing in for a firmware still on trial.
	refuse: Option<OtaError>,
	/// Byte count past which a write fails, standing in for a sector that will not take.
	fail_after: Option<usize>,
	fail_commit: bool,
}

impl MockOta {
	fn new(capacity: usize) -> Self {
		Self {
			base: MockApi::new(),
			capacity,
			busy: false,
			staging: None,
			expected: 0,
			committed: None,
			aborts: 0,
			refuse: None,
			fail_after: None,
			fail_commit: false,
		}
	}
}

impl Api for MockOta {
	fn effects(&self) -> &'static [EffectKind] {
		self.base.effects()
	}

	fn info(&self) -> InfoDto<'_> {
		self.base.info()
	}

	async fn state(&mut self) -> StateDto {
		self.base.state().await
	}

	async fn apply(&mut self, patch: Patch) -> StateDto {
		self.base.apply(patch).await
	}

	async fn identify(&mut self) {
		self.base.identify().await
	}

	fn ota_capacity(&self) -> Option<usize> {
		Some(self.capacity)
	}

	async fn ota_begin(&mut self, len: usize) -> Result<(), OtaError> {
		if self.busy {
			return Err(OtaError::Busy);
		}
		if let Some(err) = self.refuse {
			return Err(err);
		}
		self.busy = true;
		self.expected = len;
		self.staging = Some(Vec::new());
		Ok(())
	}

	async fn ota_write(&mut self, chunk: &[u8]) -> Result<(), OtaError> {
		if !self.busy {
			return Err(OtaError::OutOfOrder);
		}
		let (expected, fail_after) = (self.expected, self.fail_after);
		let staging = self.staging.as_mut().expect("busy without a buffer");
		if staging.len() + chunk.len() > expected {
			return Err(OtaError::TooLarge);
		}
		if fail_after.is_some_and(|at| staging.len() + chunk.len() > at) {
			return Err(OtaError::Flash);
		}
		staging.extend_from_slice(chunk);
		Ok(())
	}

	async fn ota_commit(&mut self) -> Result<(), OtaError> {
		if !self.busy {
			return Err(OtaError::OutOfOrder);
		}
		if self.fail_commit {
			return Err(OtaError::Flash);
		}
		let staged = self.staging.take().expect("busy without a buffer");
		if staged.len() != self.expected {
			return Err(OtaError::Truncated);
		}
		self.committed = Some(staged);
		self.busy = false;
		Ok(())
	}

	async fn ota_abort(&mut self) {
		self.aborts += 1;
		self.busy = false;
		self.staging = None;
	}
}

/// A pattern rather than zeroes, so a test can tell a dropped or reordered chunk from a short one.
fn image(len: usize) -> Vec<u8> {
	(0..len).map(|i| (i % 251) as u8).collect()
}

fn ota_request(declared: usize, body: &[u8]) -> Vec<u8> {
	let mut req = Vec::new();
	req.extend_from_slice(b"POST /api/ota HTTP/1.1\r\nContent-Length: ");
	req.extend_from_slice(std::format!("{declared}").as_bytes());
	req.extend_from_slice(b"\r\n\r\n");
	req.extend_from_slice(body);
	req
}

#[test]
fn ota_streams_an_image_larger_than_any_buffer() {
	let mut api = MockOta::new(64 * 1024);
	let body = image(9000);
	let req = ota_request(9000, &body);
	let (res, served) = run_ota(&mut api, &[&req]);

	assert!(res.starts_with("HTTP/1.1 200"), "{res}");
	assert_eq!(api.committed.as_deref(), Some(body.as_slice()));
	assert_eq!(served, Served::Reboot);
	assert_eq!(api.aborts, 0);
}

#[test]
fn ota_reassembles_an_image_split_across_reads() {
	let mut api = MockOta::new(64 * 1024);
	let body = image(4096);
	let head = ota_request(4096, &body[..100]);
	let (res, _) = run_ota(&mut api, &[&head, &body[100..2000], &body[2000..]]);

	assert!(res.starts_with("HTTP/1.1 200"), "{res}");
	assert_eq!(api.committed.as_deref(), Some(body.as_slice()));
}

#[test]
fn ota_takes_an_image_one_byte_at_a_time() {
	let mut api = MockOta::new(1024);
	let body = image(64);
	let head = ota_request(64, b"");
	let mut input: Vec<&[u8]> = std::vec![&head];
	input.extend(body.chunks(1));
	let (res, _) = run_ota(&mut api, &input);

	assert!(res.starts_with("HTTP/1.1 200"), "{res}");
	assert_eq!(api.committed.as_deref(), Some(body.as_slice()));
}

#[test]
fn ota_stops_at_the_declared_length() {
	let mut api = MockOta::new(64 * 1024);
	let body = image(512);
	let mut req = ota_request(512, &body);
	req.extend_from_slice(b"GET /api/state HTTP/1.1\r\n\r\n");
	let (res, _) = run_ota(&mut api, &[&req]);

	assert!(res.starts_with("HTTP/1.1 200"), "{res}");
	// Anything past the declared length belongs to no image and must not reach the slot.
	assert_eq!(api.committed.as_deref(), Some(body.as_slice()));
}

#[test]
fn ota_accepts_an_image_that_exactly_fills_the_slot() {
	let mut api = MockOta::new(2048);
	let body = image(2048);
	let (res, _) = run_ota(&mut api, &[&ota_request(2048, &body)]);

	assert!(res.starts_with("HTTP/1.1 200"), "{res}");
	assert_eq!(api.committed.as_deref(), Some(body.as_slice()));
}

#[test]
fn ota_refuses_an_image_too_big_for_the_slot_without_claiming_it() {
	let mut api = MockOta::new(2048);
	let (res, served) = run_ota(&mut api, &[&ota_request(2049, &image(2049))]);

	assert!(res.starts_with("HTTP/1.1 413"), "{res}");
	assert_eq!(served, Served::Done);
	assert!(!api.busy, "an image that cannot fit must not claim the slot");
	assert_eq!(api.aborts, 0, "nor release it");
	assert!(api.committed.is_none());
}

#[test]
fn ota_refuses_an_empty_image() {
	let mut api = MockOta::new(1024);
	let (res, _) = run_ota(&mut api, &[&ota_request(0, b"")]);

	assert!(res.starts_with("HTTP/1.1 400"), "{res}");
	assert_eq!(api.aborts, 0);
	assert!(api.committed.is_none());
}

#[test]
fn ota_requires_a_content_length() {
	let mut api = MockOta::new(1024);
	let (res, _) = run_ota(&mut api, &[b"POST /api/ota HTTP/1.1\r\n\r\n"]);

	assert!(res.starts_with("HTTP/1.1 411"), "{res}");
	assert_eq!(api.aborts, 0);
	assert!(!api.busy);
}

#[test]
fn ota_is_not_offered_by_a_board_with_one_slot() {
	let mut api = MockApi::new();
	let res = run(&mut api, &[&ota_request(16, &image(16))]);
	assert!(res.starts_with("HTTP/1.1 501"), "{res}");
}

/// The regression test for a refusal releasing a slot it never owned: on the real board `busy`
/// is the only thing keeping two listeners apart.
#[test]
fn a_refused_upload_leaves_the_one_in_flight_alone() {
	let mut api = MockOta::new(64 * 1024);
	block_on(api.ota_begin(9000)).unwrap();
	block_on(api.ota_write(&image(4096))).unwrap();

	// Every refusal a second listener can raise, none of which owns the slot.
	for req in [ota_request(999_999, b""), ota_request(0, b""), ota_request(512, &image(512))] {
		let (res, served) = run_ota(&mut api, &[&req]);
		assert!(res.starts_with("HTTP/1.1 4"), "{res}");
		assert_eq!(served, Served::Done);
	}

	assert_eq!(api.aborts, 0, "a refusal must not release another upload's slot");
	assert!(api.busy, "the upload in flight still owns it");
	assert_eq!(api.staging.as_ref().map(Vec::len), Some(4096), "and keeps its bytes");
}

#[test]
fn ota_refuses_while_the_running_firmware_is_unconfirmed() {
	let mut api = MockOta::new(64 * 1024);
	api.refuse = Some(OtaError::Unconfirmed);
	let (res, _) = run_ota(&mut api, &[&ota_request(512, &image(512))]);

	assert!(res.starts_with("HTTP/1.1 409"), "{res}");
	assert!(res.contains("unconfirmed"), "{res}");
	assert_eq!(api.aborts, 0);
}

#[test]
fn ota_releases_the_slot_when_the_upload_stops_early() {
	let mut api = MockOta::new(64 * 1024);
	let body = image(4096);
	// Declares 4096 bytes, then the connection ends after 1000 of them.
	let (res, served) = run_ota(&mut api, &[&ota_request(4096, &body[..1000])]);

	assert!(res.starts_with("HTTP/1.1 400"), "{res}");
	assert_eq!(served, Served::Done);
	assert!(api.committed.is_none(), "a half image must never be marked bootable");
	assert_eq!(api.aborts, 1, "the slot has to be released for the next attempt");
	assert!(!api.busy);
}

#[test]
fn ota_releases_the_slot_when_flash_refuses_a_write() {
	let mut api = MockOta::new(64 * 1024);
	// Past the first write, so this is a failure with bytes already staged.
	api.fail_after = Some(600);
	let body = image(4096);
	let head = ota_request(4096, &body[..256]);
	let (res, served) = run_ota(&mut api, &[&head, &body[256..1024], &body[1024..]]);

	assert!(res.starts_with("HTTP/1.1 500"), "{res}");
	assert_eq!(served, Served::Done);
	assert!(api.committed.is_none());
	assert_eq!(api.aborts, 1);
	assert!(!api.busy);
}

#[test]
fn ota_releases_the_slot_when_the_commit_fails() {
	let mut api = MockOta::new(64 * 1024);
	api.fail_commit = true;
	let (res, served) = run_ota(&mut api, &[&ota_request(512, &image(512))]);

	assert!(res.starts_with("HTTP/1.1 500"), "{res}");
	assert_eq!(served, Served::Done);
	assert!(api.committed.is_none());
	assert_eq!(api.aborts, 1);
}

#[test]
fn only_a_committed_image_asks_the_caller_to_reboot() {
	let mut api = MockOta::new(64 * 1024);
	let mut conn = MockConn::new(&[b"GET /api/state HTTP/1.1\r\n\r\n"]);
	assert_eq!(block_on(serve(&mut conn, &mut api)).unwrap(), Served::Done);

	api.fail_commit = true;
	let (_, served) = run_ota(&mut api, &[&ota_request(512, &image(512))]);
	assert_eq!(served, Served::Done, "a commit that failed must not ask for a reboot");

	api.fail_commit = false;
	let (_, served) = run_ota(&mut api, &[&ota_request(512, &image(512))]);
	assert_eq!(served, Served::Reboot);
}

#[test]
fn ota_answers_the_wrong_method() {
	let mut api = MockOta::new(64 * 1024);
	let (res, _) = run_ota(&mut api, &[b"GET /api/ota HTTP/1.1\r\n\r\n"]);
	assert!(res.starts_with("HTTP/1.1 405"), "{res}");
}

/// A long header run used to make `total` index past the buffer and panic, which panic-reset
/// turns into a reboot from one oversized header.
#[test]
fn a_long_header_run_is_refused_rather_than_fatal() {
	let mut api = MockApi::new();
	let mut req = Vec::new();
	req.extend_from_slice(b"POST /api/state HTTP/1.1\r\nContent-Length: 14\r\nCookie: ");
	req.resize(1528, b'x');
	req.extend_from_slice(b"\r\n\r\n");
	let res = run(&mut api, &[&req]);

	assert!(res.starts_with("HTTP/1.1 413"), "{res}");
}
