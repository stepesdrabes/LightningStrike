use embassy_futures::select::{Either, Either4, select, select4};
use embassy_net::udp::{PacketMetadata, UdpSocket};
use embassy_net::{IpEndpoint, Stack};
use embassy_time::{Duration, Instant, Timer};
use room_light::engine::{Engine, Save};
use room_wire::frame::Frame;
use room_wire::hello::Identity;
use room_wire::stats::Stats;
use room_wire::{ddp, hello};

use crate::config::{DDP_PORT, HTTP_PORT, STATS_PORT};
use crate::fixture::Fixture;
use crate::httpd::{REQUESTS, Request};
use crate::persist::Persist;
use crate::select;

const IDENTITY: Identity<'static> = Identity {
	hostname: Fixture::HOSTNAME,
	firmware: env!("CARGO_PKG_VERSION"),
	pixels: Fixture::PIXELS,
	ddp_port: DDP_PORT,
	stats_port: STATS_PORT,
	leds: Fixture::KIND,
	http_port: HTTP_PORT,
};

/// Debounce slider drags while saving soon enough for a following wall-switch power cut.
const SAVE_DEBOUNCE: Duration = Duration::from_secs(2);

/// Fade into remembered light while the radio joins.
pub async fn run_engine(fixture: &mut Fixture, engine: &mut Engine<{ Fixture::PIXELS }>) -> ! {
	loop {
		if let Some(out) = engine.tick(Instant::now().as_millis()) {
			fixture.show(out).await;
		}
		Timer::after(Fixture::ENGINE_PERIOD).await;
	}
}

/// One loop handles datagrams, telemetry, and engine ticks. embassy-net requires tasks at
/// one priority, so all use the thread-mode executor.
pub async fn run(
	stack: Stack<'static>,
	fixture: &mut Fixture,
	engine: &mut Engine<{ Fixture::PIXELS }>,
	persist: &mut Persist,
) -> ! {
	let addr = stack.config_v4().unwrap().address.address();
	log::info!(
		"{} on {addr}, DDP :{DDP_PORT}, stats -> :{STATS_PORT}, http :{HTTP_PORT}",
		Fixture::HOSTNAME
	);

	// Socket buffering absorbs frame bursts beyond cyw43's four datagram slots.
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
	let mut tick_at = boot;
	let mut save_at: Option<Instant> = None;

	loop {
		// A settled network choice ends the loop by rebooting, so it sits outside the four.
		let event = match select(
			select4(
				socket.recv_from(&mut pkt),
				REQUESTS.receive(),
				Timer::at(report_at),
				Timer::at(tick_at),
			),
			select::wait_commit(),
		)
		.await
		{
			Either::First(event) => event,
			Either::Second(index) => {
				select::save(persist, index).await;
				continue;
			}
		};
		match event {
			Either4::First(Ok((n, meta))) => {
				let now = Instant::now();

				// Answered on the asker's own port, before the parse, so it never counts as `bad`.
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

				// Sequence gaps indicate loss only for one DDP target; a split host counter strides between boards.
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

				let show = engine.on_ddp(now.as_millis());
				if p.push {
					let presented = Instant::now();
					if show {
						fixture.present(frame.pixels()).await;
						// So a party can end by fading the frame the room actually showed.
						engine.hold(frame.pixels());
					}
					let led = (Instant::now() - presented).as_micros() as u32;
					if !frame.close() {
						stats.torn += 1;
					}

					// End network timing at PUSH arrival so fixture-write cost cannot leak into it.
					let gap = last_push.map_or(0, |t| (now - t).as_micros() as u32);
					let assembled = frame_start.map_or(0, |t| (now - t).as_micros() as u32);
					stats.on_frame(gap, assembled, led);
					last_push = Some(now);
					frame_start = None;
				}
			}
			Either4::First(Err(_)) => stats.bad += 1,
			Either4::Second(envelope) => {
				if let Request::Cmd(cmd) = envelope.req {
					match engine.on_command(Instant::now().as_millis(), cmd) {
						// Off is the state a power cut must find, so it skips the debounce.
						Save::Immediate => {
							persist.save(&engine.settings()).await;
							save_at = None;
						}
						Save::Debounced => save_at = Some(Instant::now() + SAVE_DEBOUNCE),
						Save::No => {}
					}
				}
				envelope.reply.signal(engine.status());
			}
			Either4::Third(_) => {
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

			Either4::Fourth(_) => {
				let now = Instant::now();
				if let Some(out) = engine.tick(now.as_millis()) {
					fixture.show(out).await;
				}
				if save_at.is_some_and(|at| now >= at) {
					persist.save(&engine.settings()).await;
					save_at = None;
				}
				tick_at = now + Fixture::ENGINE_PERIOD;
			}
		}
	}
}
