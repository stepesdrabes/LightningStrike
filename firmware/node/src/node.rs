use embassy_futures::select::{Either3, select3};
use embassy_net::udp::{PacketMetadata, UdpSocket};
use embassy_net::{IpEndpoint, Stack};
use embassy_time::{Duration, Instant, Timer};
use room_wire::frame::Frame;
use room_wire::hello::Identity;
use room_wire::stats::Stats;
use room_wire::{ddp, hello};

use crate::config::{DDP_PORT, STATS_PORT};
use crate::fixture::Fixture;

/// How long after the last frame the room goes back to idling. Two frames at 60 fps is noise; this
/// is longer than any stall the radio has been measured to produce.
const IDLE_AFTER: Duration = Duration::from_millis(750);

const IDENTITY: Identity<'static> = Identity {
	hostname: Fixture::HOSTNAME,
	firmware: env!("CARGO_PKG_VERSION"),
	pixels: Fixture::PIXELS,
	ddp_port: DDP_PORT,
	stats_port: STATS_PORT,
	leds: Fixture::KIND,
};

/// The whole program after bringup: one loop selecting between a datagram and the 1 Hz report.
///
/// Everything runs in the one thread-mode executor because embassy-net requires all its tasks at
/// the same priority.
pub async fn run(stack: Stack<'static>, fixture: &mut Fixture) -> ! {
	let addr = stack.config_v4().unwrap().address.address();
	log::info!("{} on {addr}, DDP :{DDP_PORT}, stats -> :{STATS_PORT}", Fixture::HOSTNAME);

	// A frame is several back-to-back datagrams and cyw43 only holds four, so the socket is sized
	// to absorb a burst the driver could not.
	let mut rx_meta = [PacketMetadata::EMPTY; 16];
	let mut rx_buffer = [0; 8192];
	let mut tx_meta = [PacketMetadata::EMPTY; 4];
	let mut tx_buffer = [0; 512];
	let mut pkt = [0; 1500];

	let mut socket =
		UdpSocket::new(stack, &mut rx_meta, &mut rx_buffer, &mut tx_meta, &mut tx_buffer);
	socket.bind(DDP_PORT).unwrap();

	let mut frame = Frame::<{ Fixture::BYTES }>::new();
	let mut stats = Stats::new();

	let boot = Instant::now();
	let mut reported = boot;
	let mut report_at = boot + Duration::from_secs(1);
	let mut last_seq = 0u8;
	let mut last_push: Option<Instant> = None;
	let mut frame_start: Option<Instant> = None;
	let mut peer: Option<IpEndpoint> = None;
	let mut idle_at = boot;

	loop {
		match select3(socket.recv_from(&mut pkt), Timer::at(report_at), Timer::at(idle_at)).await {
			Either3::First(Ok((n, meta))) => {
				let now = Instant::now();

				// Answered before the parse and on the asker's own port, so discovery needs no
				// listener on the stats port and never counts against `bad`.
				if hello::is_query(&pkt[..n]) {
					let line = hello::line(&IDENTITY, (now - boot).as_secs());
					let _ = socket.send_to(line.as_bytes(), meta.endpoint).await;
					continue;
				}

				let Some(p) = ddp::parse(&pkt[..n]) else {
					stats.bad += 1;
					continue;
				};

				stats.packets += 1;
				stats.bytes += n as u32;

				// Only a loss signal while this board is the sole DDP target: the host's counter
				// spans every target, so a split fixture strides rather than steps.
				if last_seq != 0 && p.seq != ddp::next_seq(last_seq) {
					stats.seq_gaps += 1;
				}
				last_seq = p.seq;

				if frame_start.is_none() {
					frame_start = Some(now);
				}
				peer = Some(IpEndpoint::new(meta.endpoint.addr, STATS_PORT));

				if !frame.apply(&p) {
					stats.out_of_range += 1;
				}

				if p.push {
					let presented = Instant::now();
					fixture.present(frame.pixels()).await;
					let led = (Instant::now() - presented).as_micros() as u32;
					if !frame.close() {
						stats.torn += 1;
					}

					// All three spans are measured from `now`, the moment PUSH arrived, so what
					// the fixture costs cannot leak into the two numbers about the network.
					let gap = last_push.map_or(0, |t| (now - t).as_micros() as u32);
					let assembled = frame_start.map_or(0, |t| (now - t).as_micros() as u32);
					stats.on_frame(gap, assembled, led);
					last_push = Some(now);
					frame_start = None;
				}
			}
			Either3::First(Err(_)) => stats.bad += 1,
			Either3::Second(_) => {
				let now = Instant::now();
				let line = stats.drain(
					(now - boot).as_secs(),
					(now - reported).as_millis(),
					frame.last_extent() / 3,
				);
				log::info!("{line}");
				if let Some(ep) = peer {
					let _ = socket.send_to(line.as_bytes(), ep).await;
				}
				reported = now;
				report_at = now + Duration::from_secs(1);
			}
			// Idling is the room's resting state, not an error one: it runs before the first frame
			// ever arrives and returns whenever a show stops, which is also what stops the strips
			// holding the last frame of one.
			Either3::Third(_) => {
				let now = Instant::now();
				if last_push.is_none_or(|t| now - t > IDLE_AFTER) {
					fixture.idle().await;
				}
				idle_at = now + Fixture::IDLE_PERIOD;
			}
		}
	}
}
