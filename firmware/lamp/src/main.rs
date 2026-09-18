#![no_std]
#![no_main]

mod config;
mod fixture;
mod httpd;
mod net;
mod node;
mod persist;
mod select;
mod status;

use embassy_executor::Spawner;
use embassy_futures::select::{Either3, select3};
use embassy_time::Instant;
use esp_backtrace as _;
use esp_hal::clock::CpuClock;
use esp_hal::interrupt::software::SoftwareInterruptControl;
use esp_hal::ram;
use esp_hal::timer::timg::TimerGroup;
use room_light::engine::Engine;

use crate::fixture::{Fixture, Pins};
use crate::persist::Persist;
use crate::status::Status;

esp_bootloader_esp_idf::esp_app_desc!();

#[esp_rtos::main]
async fn main(spawner: Spawner) -> ! {
	esp_println::logger::init_logger_from_env();
	let p = esp_hal::init(esp_hal::Config::default().with_cpu_clock(CpuClock::max()));

	// The radio's own sizing, per the esp-hal wifi examples.
	esp_alloc::heap_allocator!(#[ram(reclaimed)] size: 64 * 1024);
	esp_alloc::heap_allocator!(size: 36 * 1024);

	let timg0 = TimerGroup::new(p.TIMG0);
	let sw_int = SoftwareInterruptControl::new(p.SW_INTERRUPT);
	esp_rtos::start(timg0.timer0, sw_int.software_interrupt0);

	let mut fixture =
		Fixture::claim(Pins { ledc: p.LEDC, r: p.GPIO3, g: p.GPIO4, b: p.GPIO5, w: p.GPIO6 });
	let status = Status::new(p.RMT, p.GPIO10);
	// Before the radio, so a join that never lands cannot hide the wiring check.
	fixture.selftest().await;

	let mut persist = Persist::new(p.FLASH);
	let remembered = persist.load(Fixture::DEFAULTS).await;
	let network = persist.load_network().await;
	let mut engine = Engine::<{ Fixture::PIXELS }>::new(Instant::now().as_millis(), remembered);

	// The join takes a second or two and the light should not be dark for it. The button is
	// watched here too, because a join that never lands is when it is pressed.
	let stack = match select3(
		net::join(spawner, p.WIFI, p.GPIO9, Fixture::HOSTNAME, status, network),
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
