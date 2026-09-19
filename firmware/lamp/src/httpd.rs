//! HTTP bridge to the fixture-owning loop, over this board's embassy-net.

use embassy_executor::Spawner;
use embassy_net::Stack;
use embassy_net::tcp::TcpSocket;
use embassy_sync::blocking_mutex::raw::CriticalSectionRawMutex;
use embassy_sync::channel::Channel;
use embassy_sync::signal::Signal;
use embassy_time::{Duration, Instant, with_timeout};
use heapless::String;
use room_light::api::{Command, InfoDto, Patch, StateDto};
use room_light::state::EffectKind;

use crate::config::{DDP_PORT, HTTP_PORT, STATS_PORT};
use crate::fixture::Fixture;

/// Listeners, and therefore the number of requests that can be in the loop's hands at once.
/// There is no accept backlog, so a SYN arriving while every listener is busy is refused rather
/// than queued. FIRMWARE.md has what that cost and what the count is set against.
const LISTENERS: usize = 4;

/// How long the close handshake may hold a listener once the response is acknowledged.
/// A browser closes the moment it has the body, and the listener then stayed busy for most
/// of a second, a FIN retransmit timeout, often enough that a few taps refused the next knock
/// (measured 2026-09-19 on The Frame). Past this the connection is reset, which costs the
/// client nothing.
const CLOSE_GRACE: Duration = Duration::from_millis(150);

pub enum Request {
	Cmd(Command),
	Query,
}

/// Where one request's answer goes. One per listener, claimed at spawn and never shared.
pub type Reply = Signal<CriticalSectionRawMutex, StateDto>;

/// Each request carries its own reply slot so concurrent connections cannot exchange or lose answers.
pub struct Envelope {
	pub req: Request,
	pub reply: &'static Reply,
}

/// One slot per listener, so no listener can be held waiting for room to ask its question.
pub static REQUESTS: Channel<CriticalSectionRawMutex, Envelope, LISTENERS> = Channel::new();

static REPLIES: [Reply; LISTENERS] = [const { Signal::new() }; LISTENERS];

struct NodeApi<'a> {
	ip: &'a str,
	reply: &'static Reply,
}

impl NodeApi<'_> {
	async fn round_trip(&self, req: Request) -> StateDto {
		// An answer to a request this connection gave up on would otherwise be read as this one's.
		self.reply.reset();
		REQUESTS.send(Envelope { req, reply: self.reply }).await;
		self.reply.wait().await
	}
}

impl room_api::Api for NodeApi<'_> {
	fn effects(&self) -> &'static [EffectKind] {
		Fixture::EFFECTS
	}

	fn info(&self) -> InfoDto<'_> {
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

#[embassy_executor::task(pool_size = LISTENERS)]
pub async fn httpd_task(stack: Stack<'static>, reply: &'static Reply) -> ! {
	let mut rx = [0; 1024];
	let mut tx = [0; 1024];
	loop {
		let mut socket = TcpSocket::new(stack, &mut rx, &mut tx);
		// Covers a dead client mid-request; a healthy exchange is milliseconds.
		socket.set_timeout(Some(Duration::from_secs(5)));
		if socket.accept(HTTP_PORT).await.is_err() {
			continue;
		}
		// Read per request, not once at startup: the button can move the board to another
		// network, and the answer has to be the subnet it is on now.
		let mut ip: String<15> = String::new();
		if let Some(config) = stack.config_v4() {
			let _ = core::fmt::write(&mut ip, format_args!("{}", config.address.address()));
		}
		let served = room_api::serve(&mut socket, &mut NodeApi { ip: &ip, reply }).await;
		// A graceful close, but not at any price: a client that vanished mid-request, or one
		// whose last acknowledgement never lands, gets a reset instead. On this radio a round
		// trip is not small, and a listener spent waiting is a knock refused.
		let closed = served.is_ok() && {
			socket.close();
			with_timeout(CLOSE_GRACE, socket.flush()).await.is_ok()
		};
		if !closed {
			socket.abort();
			let _ = socket.flush().await;
		}
	}
}

pub fn spawn(spawner: Spawner, stack: Stack<'static>) {
	for reply in &REPLIES {
		spawner.spawn(httpd_task(stack, reply).unwrap());
	}
}
