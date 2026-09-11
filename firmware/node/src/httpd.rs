//! HTTP bridge with two connections, limiting radio receive-slot usage.

use embassy_executor::Spawner;
use embassy_net::Stack;
use embassy_net::tcp::TcpSocket;
use embassy_sync::blocking_mutex::raw::CriticalSectionRawMutex;
use embassy_sync::channel::Channel;
use embassy_sync::signal::Signal;
use embassy_time::{Duration, Instant};
use heapless::String;
use room_light::api::{Command, InfoDto, Patch, StateDto};
use room_light::state::EffectKind;
use static_cell::StaticCell;

use crate::config::{DDP_PORT, HTTP_PORT, STATS_PORT};
use crate::fixture::Fixture;

/// Listeners, and therefore the number of requests that can be in the loop's hands at once.
const LISTENERS: usize = 2;

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

pub static REQUESTS: Channel<CriticalSectionRawMutex, Envelope, 4> = Channel::new();

static REPLIES: [Reply; LISTENERS] = [const { Signal::new() }; LISTENERS];

struct NodeApi {
	ip: &'static str,
	reply: &'static Reply,
}

impl NodeApi {
	async fn round_trip(&self, req: Request) -> StateDto {
		// An answer to a request this connection gave up on would otherwise be read as this one's.
		self.reply.reset();
		REQUESTS.send(Envelope { req, reply: self.reply }).await;
		self.reply.wait().await
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

/// Two listeners allow controller polling and commands concurrently without dropping the second SYN.
#[embassy_executor::task(pool_size = LISTENERS)]
pub async fn httpd_task(stack: Stack<'static>, ip: &'static str, reply: &'static Reply) -> ! {
	let mut rx = [0; 1024];
	let mut tx = [0; 1024];
	loop {
		let mut socket = TcpSocket::new(stack, &mut rx, &mut tx);
		// Covers a dead client mid-request; a healthy exchange is milliseconds.
		socket.set_timeout(Some(Duration::from_secs(5)));
		if socket.accept(HTTP_PORT).await.is_err() {
			continue;
		}
		let _ = room_api::serve(&mut socket, &mut NodeApi { ip, reply }).await;
		socket.close();
		let _ = socket.flush().await;
	}
}

/// Publish the DHCP address for controller subnet discovery; browsers cannot resolve .local to an IP.
pub fn spawn(spawner: Spawner, stack: Stack<'static>) {
	static IP: StaticCell<String<15>> = StaticCell::new();

	let mut text = String::new();
	if let Some(config) = stack.config_v4() {
		let _ = core::fmt::write(&mut text, format_args!("{}", config.address.address()));
	}
	let ip: &'static String<15> = IP.init(text);

	for reply in &REPLIES {
		spawner.spawn(httpd_task(stack, ip.as_str(), reply).unwrap());
	}
}
