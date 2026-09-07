//! The HTTP task and its bridge to the loop that owns the fixture. Two connections at a time is
//! the concurrency limit, which is plenty for a control plane and spares the radio's rx slots.

use embassy_executor::Spawner;
use embassy_net::Stack;
use embassy_net::tcp::TcpSocket;
use embassy_sync::blocking_mutex::raw::CriticalSectionRawMutex;
use embassy_sync::channel::Channel;
use embassy_time::{Duration, Instant};
use heapless::String;
use room_light::api::{Command, InfoDto, Patch, StateDto};
use room_light::state::EffectKind;
use static_cell::StaticCell;

use crate::config::{DDP_PORT, HTTP_PORT, STATS_PORT};
use crate::fixture::Fixture;

pub enum Request {
	Cmd(Command),
	Query,
}

/// Every request is answered with the state that resulted, over REPLIES; one connection at a
/// time makes that pairing deterministic.
pub static REQUESTS: Channel<CriticalSectionRawMutex, Request, 4> = Channel::new();
pub static REPLIES: Channel<CriticalSectionRawMutex, StateDto, 1> = Channel::new();

struct NodeApi {
	ip: &'static str,
}

impl NodeApi {
	async fn round_trip(&self, req: Request) -> StateDto {
		while REPLIES.try_receive().is_ok() {}
		REQUESTS.send(req).await;
		REPLIES.receive().await
	}
}

impl room_api::Api for NodeApi {
	fn effects(&self) -> &'static [EffectKind] {
		Fixture::EFFECTS
	}

	fn info(&self) -> InfoDto<'static> {
		InfoDto {
			name: Fixture::HOSTNAME,
			ip: self.ip,
			firmware: env!("CARGO_PKG_VERSION"),
			uptime_s: Instant::now().as_secs(),
			pixels: Fixture::PIXELS,
			ddp_port: DDP_PORT,
			stats_port: STATS_PORT,
			leds: Fixture::KIND,
			effects: Fixture::EFFECTS,
		}
	}

	async fn state(&mut self) -> StateDto {
		self.round_trip(Request::Query).await
	}

	async fn apply(&mut self, patch: Patch) -> StateDto {
		self.round_trip(Request::Cmd(Command::Patch(patch))).await
	}

	async fn identify(&mut self) {
		self.round_trip(Request::Cmd(Command::Identify)).await;
	}
}

/// Two listeners rather than one: the controller polls while it sends, and a board with a single
/// socket drops the SYN of whichever arrives second.
#[embassy_executor::task(pool_size = 2)]
pub async fn httpd_task(stack: Stack<'static>, ip: &'static str) -> ! {
	let mut rx = [0; 1024];
	let mut tx = [0; 1024];
	loop {
		let mut socket = TcpSocket::new(stack, &mut rx, &mut tx);
		// Covers a dead client mid-request; a healthy exchange is milliseconds.
		socket.set_timeout(Some(Duration::from_secs(5)));
		if socket.accept(HTTP_PORT).await.is_err() {
			continue;
		}
		let _ = room_api::serve(&mut socket, &mut NodeApi { ip }).await;
		socket.close();
		let _ = socket.flush().await;
	}
}

/// Reads the address DHCP landed on once, so `/api/info` can report it. The controller needs it
/// to know which subnet to look for the other lights on; see `apps/controller/src/lib/discover.ts`.
pub fn spawn(spawner: Spawner, stack: Stack<'static>) {
	static IP: StaticCell<String<15>> = StaticCell::new();

	let mut text = String::new();
	if let Some(config) = stack.config_v4() {
		let _ = core::fmt::write(&mut text, format_args!("{}", config.address.address()));
	}
	let ip: &'static String<15> = IP.init(text);

	for _ in 0..2 {
		spawner.spawn(httpd_task(stack, ip.as_str()).unwrap());
	}
}
