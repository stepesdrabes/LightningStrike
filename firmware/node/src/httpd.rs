//! The HTTP task and its bridge to the loop that owns the fixture. One connection at a time is
//! the concurrency limit, which is plenty for a control plane and spares the radio's rx slots.

use embassy_net::Stack;
use embassy_net::tcp::TcpSocket;
use embassy_sync::blocking_mutex::raw::CriticalSectionRawMutex;
use embassy_sync::channel::Channel;
use embassy_time::{Duration, Instant};
use room_light::api::{Command, InfoDto, Patch, StateDto};
use room_light::state::EffectKind;

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

struct NodeApi;

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

#[embassy_executor::task]
pub async fn httpd_task(stack: Stack<'static>) -> ! {
	let mut rx = [0; 1024];
	let mut tx = [0; 1024];
	loop {
		let mut socket = TcpSocket::new(stack, &mut rx, &mut tx);
		// Covers a dead client mid-request; a healthy exchange is milliseconds.
		socket.set_timeout(Some(Duration::from_secs(5)));
		if socket.accept(HTTP_PORT).await.is_err() {
			continue;
		}
		let _ = room_api::serve(&mut socket, &mut NodeApi).await;
		socket.close();
		let _ = socket.flush().await;
	}
}
