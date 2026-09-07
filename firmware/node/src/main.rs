#![no_std]
#![no_main]

mod board;
mod config;
mod fixture;
mod httpd;
mod irq;
mod net;
mod node;
mod persist;

use embassy_executor::Spawner;
use embassy_futures::select::{Either, select};
use embassy_time::Instant;
use room_light::engine::Engine;

use crate::fixture::Fixture;
use crate::persist::Persist;

// A panic reboots and reprints the banner, which is what tells it apart from a WiFi drop. cyw43
// has open panics on a bad password and on rejoining while already associated.
use panic_reset as _;

#[embassy_executor::main]
async fn main(spawner: Spawner) -> ! {
	let (mut fixture, board, store) = Fixture::claim(embassy_rp::init(Default::default()));
	// Before the radio, so a join that never lands cannot hide the wiring check.
	fixture.selftest().await;

	let mut persist = Persist::new(store);
	let remembered = persist.load(Fixture::DEFAULTS).await;
	let mut engine = Engine::<{ Fixture::PIXELS }>::new(Instant::now().as_millis(), remembered);

	// The join takes a second or two and the light should not be dark for it.
	let stack = match select(
		net::join(spawner, board, Fixture::HOSTNAME),
		node::run_engine(&mut fixture, &mut engine),
	)
	.await
	{
		Either::First(stack) => stack,
		Either::Second(never) => never,
	};
	httpd::spawn(spawner, stack);
	node::run(stack, &mut fixture, &mut engine, &mut persist).await
}
