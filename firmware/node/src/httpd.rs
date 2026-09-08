//! The HTTP task and its bridge to the loop that owns the fixture. Two connections at a time is
//! the concurrency limit, which is plenty for a control plane and spares the radio's rx slots.

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

/// A request and the slot its answer belongs in.
///
/// The slot travels with the request because two connections are served at once, and a single
/// shared mailbox pairs answers to requests only while there is one of each. With two in flight
/// the loop's second answer was dropped on a full channel and that connection blocked until its
/// socket timed out, so a colour tap that overlapped the controller's poll was lost and one of
/// only two listeners was gone for the next five seconds.
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

/// Two listeners rather than one: the controller polls while it sends, and a board with a single
/// socket drops the SYN of whichever arrives second.
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

/// Reads the address DHCP landed on once, so `/api/info` can report it. The controller needs it
/// to know which subnet to look for the other lights on; see `apps/controller/src/lib/discover.ts`.
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
