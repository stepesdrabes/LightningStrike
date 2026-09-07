use cyw43::{JoinOptions, PowerManagementMode, aligned_bytes};
use cyw43_pio::{DEFAULT_CLOCK_DIVIDER, PioSpi};
use embassy_executor::Spawner;
use embassy_net::{Config, DhcpConfig, StackResources};
use embassy_rp::clocks::RoscRng;
use embassy_rp::gpio::{Level, Output};
use embassy_rp::peripherals::{DMA_CH0, PIN_24, PIN_25, PIN_29, PIO0, USB};
use embassy_rp::pio::Pio;
use embassy_rp::usb::Driver;
use embassy_rp::{Peri, dma};
use embassy_time::Timer;
use heapless::String;
use static_cell::StaticCell;

use crate::board::Board;
use crate::config::{WIFI_PASSWORD, WIFI_SSID};
use crate::irq::Irqs;

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

/// The only status the board can show without a console: solid means still joining, blinking
/// means up.
#[embassy_executor::task]
async fn heartbeat_task(mut control: cyw43::Control<'static>) {
	loop {
		control.gpio_set(0, true).await;
		Timer::after_millis(60).await;
		control.gpio_set(0, false).await;
		Timer::after_millis(940).await;
	}
}

/// The console, the radio and DHCP, in that order, returning once the board has an address. The
/// logger comes up first because its banner is how anyone learns the address.
pub async fn join(spawner: Spawner, board: Board, hostname: &str) -> embassy_net::Stack<'static> {
	spawner.spawn(logger_task(Driver::new(board.usb, Irqs)).unwrap());

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

	// Measured as a no-op with cyw43 0.7.0: PowerSave and None give the same idle-ping
	// distribution. Kept for the day the driver honours it.
	control.set_power_management(PowerManagementMode::None).await;

	let mut dhcp = DhcpConfig::default();
	dhcp.hostname = Some(String::try_from(hostname).unwrap());

	// One slot each for DHCP, the DDP socket and the two HTTP listeners, plus headroom.
	static RESOURCES: StaticCell<StackResources<8>> = StaticCell::new();
	let mut rng = RoscRng;
	let (stack, net_runner) = embassy_net::new(
		net_device,
		Config::dhcpv4(dhcp),
		RESOURCES.init(StackResources::new()),
		rng.next_u64(),
	);
	spawner.spawn(net_task(net_runner).unwrap());

	control.gpio_set(0, true).await;
	while let Err(err) = control.join(WIFI_SSID, JoinOptions::new(WIFI_PASSWORD.as_bytes())).await {
		log::warn!("join failed: {:?}, retrying", err);
	}
	stack.wait_link_up().await;
	stack.wait_config_up().await;
	spawner.spawn(heartbeat_task(control).unwrap());

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
