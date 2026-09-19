#![no_std]
#![no_main]

mod board;
mod config;
mod fixture;
mod health;
mod httpd;
mod irq;
mod net;
mod node;
mod ota;
mod persist;
mod select;

use embassy_boot::AlignedBuffer;
use embassy_executor::Spawner;
use embassy_futures::select::{Either3, select3};
use embassy_rp::flash::Flash;
use embassy_rp::watchdog::Watchdog;
use embassy_sync::blocking_mutex::raw::NoopRawMutex;
use embassy_sync::mutex::Mutex;
use embassy_time::Instant;
use room_light::engine::Engine;
use static_cell::StaticCell;

use crate::board::SharedFlash;
use crate::fixture::Fixture;
use crate::irq::Irqs;
use crate::ota::Ota;
use crate::persist::Persist;

// Panic reboot reprints the banner, distinguishing it from WiFi loss; cyw43 may panic during joining.
use panic_reset as _;

static FLASH: StaticCell<SharedFlash> = StaticCell::new();
static STATE_WORD: StaticCell<AlignedBuffer<4>> = StaticCell::new();
static SLOT: StaticCell<Mutex<NoopRawMutex, Ota>> = StaticCell::new();

/// A flash hiccup should not cost a working update, and the write is one byte into an erased
/// sector, so a retry is nearly free.
const CONFIRM_TRIES: usize = 3;

#[embassy_executor::main]
async fn main(spawner: Spawner) -> ! {
	let (mut fixture, board, store) = Fixture::claim(embassy_rp::init(Default::default()));

	let flash = FLASH.init(Mutex::new(Flash::new(store.flash, store.dma, Irqs)));
	let state_word = STATE_WORD.init(AlignedBuffer([0; 4]));
	let slot = SLOT.init(Mutex::new(Ota::new(flash, state_word.0.as_mut_slice())));
	let (trial, capacity) = {
		let mut slot = slot.lock().await;
		(slot.on_trial().await, slot.capacity())
	};

	// Ahead of the selftest, which on the bench fixture runs for longer than the window the
	// bootloader armed. Anything slow that happens before the first feed is a reset loop.
	spawner.spawn(health::watch(Watchdog::new(store.watchdog), trial).unwrap());

	// Before the radio, so a join that never lands cannot hide the wiring check.
	fixture.selftest().await;

	let mut persist = Persist::new(flash);
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

	// Reaching the network is what an update has to prove, because it is how the next one
	// arrives.
	if !trial || confirm(slot).await {
		health::confirm();
	}

	httpd::spawn(spawner, stack, slot, capacity);
	node::run(stack, &mut fixture, &mut engine, &mut persist).await
}

/// A board that cannot write the state word stays on trial on purpose: it would revert on its
/// next reset whatever happens here, and reverting on a deadline is the more predictable of the
/// two.
async fn confirm(slot: &'static Mutex<NoopRawMutex, Ota>) -> bool {
	for _ in 0..CONFIRM_TRIES {
		if slot.lock().await.confirm().await.is_ok() {
			return true;
		}
	}
	log::error!("update not confirmed; reverting when the trial expires");
	false
}
