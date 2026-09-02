#![no_std]
#![no_main]

mod board;
mod config;
mod fixture;
mod irq;
mod net;
mod node;

use embassy_executor::Spawner;
use embassy_futures::select::{Either, select};

use crate::fixture::Fixture;

// A panic reboots and reprints the banner, which is what tells it apart from a WiFi drop. cyw43
// has open panics on a bad password and on rejoining while already associated.
use panic_reset as _;

#[embassy_executor::main]
async fn main(spawner: Spawner) -> ! {
	let (mut fixture, board) = Fixture::claim(embassy_rp::init(Default::default()));
	// Before the radio, so a join that never lands cannot hide the wiring check.
	fixture.selftest().await;

	// The join takes a second or two and the room should not be dark for it.
	let stack =
		match select(net::join(spawner, board, Fixture::HOSTNAME), fixture.idle_forever()).await {
			Either::First(stack) => stack,
			Either::Second(never) => never,
		};
	node::run(stack, &mut fixture).await
}
