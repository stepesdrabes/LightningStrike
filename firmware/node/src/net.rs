use cyw43::{Control, JoinOptions, PowerManagementMode, aligned_bytes};
use cyw43_pio::{DEFAULT_CLOCK_DIVIDER, PioSpi};
use embassy_executor::Spawner;
use embassy_futures::select::{Either, Either3, select, select3};
use embassy_net::{Config, DhcpConfig, StackResources};
use embassy_rp::clocks::RoscRng;
use embassy_rp::gpio::{Level, Output};
use embassy_rp::peripherals::{DMA_CH0, PIN_24, PIN_25, PIN_29, PIO0, USB};
use embassy_rp::pio::Pio;
use embassy_rp::usb::Driver;
use embassy_rp::{Peri, dma};
use embassy_time::{Duration, Timer};
use heapless::String;
use static_cell::StaticCell;

use crate::board::Board;
use crate::irq::Irqs;
use crate::select::{self, BLINK, SWITCH};

/// A failed join returns as soon as the chip has swept the channels, so this is mostly the
/// window in which a button press gets its blink answered.
const RETRY: Duration = Duration::from_secs(2);

/// DHCP staying down catches an access point that vanishes without the chip noticing, which
/// the link-down event alone does not. Long enough not to fire on a slow lease.
const UNCONFIGURED_LIMIT: u32 = 60;

#[embassy_executor::task]
async fn logger_task(driver: Driver<'static, USB>) {
	embassy_usb_logger::run!(1024, log::LevelFilter::Info, driver);
}

#[embassy_executor::task]
async fn cyw43_task(
	runner: cyw43::Runner<'static, cyw43::SpiBus<Output<'static>, PioSpi<'static, PIO0, 0>>>,
) -> ! {
	runner.run().await
}

#[embassy_executor::task]
async fn net_task(mut runner: embassy_net::Runner<'static, cyw43::NetDriver<'static>>) -> ! {
	runner.run().await
}

/// The one owner of the radio, and therefore of the onboard LED: solid while joining, a
/// heartbeat once online, and the chosen network's index whenever the button asks.
#[embassy_executor::task]
async fn radio_task(
	mut control: Control<'static>,
	stack: embassy_net::Stack<'static>,
	mut index: u8,
) {
	blink(&mut control, index).await;
	loop {
		let next = serve(&mut control, stack, index).await;
		log::info!("switching to wifi {}", next + 1);
		control.leave().await;
		index = next;
	}
}

/// Join one network and stay on it, rejoining for as long as it is the chosen one. Returns
/// only when the button has settled on a different entry.
async fn serve(
	control: &mut Control<'static>,
	stack: embassy_net::Stack<'static>,
	index: u8,
) -> u8 {
	let network = room_wifi::network(index);
	log::info!("joining {}", network.ssid);
	loop {
		control.gpio_set(0, true).await;
		if let Err(e) =
			control.join(network.ssid, JoinOptions::new(network.password.as_bytes())).await
		{
			log::warn!("join {} failed: {e:?}, retrying", network.ssid);
			control.gpio_set(0, false).await;
			if let Some(next) = pause(control, RETRY).await {
				return next;
			}
			continue;
		}
		stack.wait_link_up().await;

		if let Some(next) = online(control, stack).await {
			return next;
		}
		log::warn!("network lost, rejoining {}", network.ssid);
		control.leave().await;
	}
}

/// Heartbeat until the link drops or the button moves elsewhere. Sampled once a second rather
/// than awaited, because a reconnect takes seconds anyway and one loop is easier to reason
/// about than three futures.
async fn online(control: &mut Control<'static>, stack: embassy_net::Stack<'static>) -> Option<u8> {
	let mut unconfigured = 0;
	loop {
		control.gpio_set(0, true).await;
		if let Some(next) = pause(control, Duration::from_millis(60)).await {
			return Some(next);
		}
		control.gpio_set(0, false).await;
		if let Some(next) = pause(control, Duration::from_millis(940)).await {
			return Some(next);
		}

		if !stack.is_link_up() {
			return None;
		}
		unconfigured = if stack.is_config_up() { 0 } else { unconfigured + 1 };
		if unconfigured >= UNCONFIGURED_LIMIT {
			log::warn!("no address for {UNCONFIGURED_LIMIT}s");
			return None;
		}
	}
}

/// Wait, but answer the button first: a press has to be acknowledged while the radio is still
/// hunting for a network that is not there, which is exactly when it is pressed. A settled
/// choice ends the wait so the caller can move to it.
async fn pause(control: &mut Control<'static>, wait: Duration) -> Option<u8> {
	match select3(Timer::after(wait), BLINK.wait(), SWITCH.wait()).await {
		Either3::First(()) => None,
		Either3::Second(index) => {
			blink(control, index).await;
			None
		}
		Either3::Third(index) => Some(index),
	}
}

/// index + 1 pulses, so the first entry of wifi.toml reads as one blink, held clear of the
/// heartbeat by dark on both sides. A press during either restarts the count rather than
/// queueing a second one behind it.
async fn blink(control: &mut Control<'static>, mut index: u8) {
	loop {
		control.gpio_set(0, false).await;
		Timer::after_millis(room_wifi::BLINK_LEAD_MS).await;
		for _ in 0..=index {
			control.gpio_set(0, true).await;
			Timer::after_millis(room_wifi::BLINK_ON_MS).await;
			control.gpio_set(0, false).await;
			Timer::after_millis(room_wifi::BLINK_OFF_MS).await;
		}
		match select(Timer::after_millis(room_wifi::BLINK_QUIET_MS), BLINK.wait()).await {
			Either::First(()) => return,
			Either::Second(next) => index = next,
		}
	}
}

/// Start logging before radio/DHCP so the discovered address can be reported. The button task
/// starts first of all, because a board that cannot join is a board that needs it.
pub async fn join(
	spawner: Spawner,
	board: Board,
	hostname: &str,
	index: u8,
) -> embassy_net::Stack<'static> {
	spawner.spawn(logger_task(Driver::new(board.usb, Irqs)).unwrap());
	spawner.spawn(select::poll_task(board.button, index).unwrap());

	let fw = aligned_bytes!("../../cyw43-firmware/43439A0.bin");
	let clm = aligned_bytes!("../../cyw43-firmware/43439A0_clm.bin");
	let nvram = aligned_bytes!("../../cyw43-firmware/nvram_rp2040.bin");

	let spi = spi(board.pio, board.dma, board.cs, board.dio, board.clk);
	let pwr = Output::new(board.pwr, Level::Low);

	static STATE: StaticCell<cyw43::State> = StaticCell::new();
	let (net_device, mut control, cyw43_runner) =
		cyw43::new(STATE.init(cyw43::State::new()), pwr, spi, fw, nvram).await;
	spawner.spawn(cyw43_task(cyw43_runner).unwrap());

	control.init(clm).await;

	// cyw43 0.7.0 ignores this power-save setting; retain the request for drivers that honour it.
	control.set_power_management(PowerManagementMode::None).await;

	let mut dhcp = DhcpConfig::default();
	dhcp.hostname = Some(String::try_from(hostname).unwrap());

	// One slot each for DHCP, the DDP socket and the four HTTP listeners, plus headroom.
	static RESOURCES: StaticCell<StackResources<8>> = StaticCell::new();
	let mut rng = RoscRng;
	let (stack, net_runner) = embassy_net::new(
		net_device,
		Config::dhcpv4(dhcp),
		RESOURCES.init(StackResources::new()),
		rng.next_u64(),
	);
	spawner.spawn(net_task(net_runner).unwrap());
	spawner.spawn(radio_task(control, stack, index).unwrap());

	stack.wait_config_up().await;
	stack
}

fn spi(
	pio: Peri<'static, PIO0>,
	dma: Peri<'static, DMA_CH0>,
	cs: Peri<'static, PIN_25>,
	dio: Peri<'static, PIN_24>,
	clk: Peri<'static, PIN_29>,
) -> PioSpi<'static, PIO0, 0> {
	let mut pio = Pio::new(pio, Irqs);
	PioSpi::new(
		&mut pio.common,
		pio.sm0,
		DEFAULT_CLOCK_DIVIDER,
		pio.irq0,
		Output::new(cs, Level::High),
		dio,
		clk,
		dma::Channel::new(dma, Irqs),
	)
}
