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
mod select;

use embassy_executor::Spawner;
use embassy_futures::select::{Either3, select3};
use embassy_time::Instant;
use room_light::engine::Engine;

use crate::fixture::Fixture;
use crate::persist::Persist;

// Panic reboot reprints the banner, distinguishing it from WiFi loss; cyw43 may panic during joining.
use panic_reset as _;

#[embassy_executor::main]
async fn main(spawner: Spawner) -> ! {
	let (mut fixture, board, store) = Fixture::claim(embassy_rp::init(Default::default()));
	// Before the radio, so a join that never lands cannot hide the wiring check.
	fixture.selftest().await;

	let mut persist = Persist::new(store);
	let remembered = persist.load(Fixture::DEFAULTS).await;
	let network = persist.load_network().await;
	let mut engine = Engine::<{ Fixture::PIXELS }>::new(Instant::now().as_millis(), remembered);

	// The join takes a second or two and the light should not be dark for it. The button is
	// watched here too, because a join that never lands is when it is pressed.
	let stack = match select3(
		net::join(spawner, board, Fixture::HOSTNAME, network),
		node::run_engine(&mut fixture, &mut engine),
		select::commit(&mut persist),
	)
	.await
	{
		Either3::First(stack) => stack,
		Either3::Second(never) | Either3::Third(never) => never,
	};
	httpd::spawn(spawner, stack);
	node::run(stack, &mut fixture, &mut engine, &mut persist).await
}
