use embassy_executor::Spawner;
use embassy_net::{Config, DhcpConfig, Runner, StackResources};
use esp_hal::peripherals::WIFI;
use esp_hal::rng::Rng;
use esp_radio::wifi::sta::StationConfig;
use esp_radio::wifi::{Config as WifiConfig, ControllerConfig, Interface, WifiController};
use heapless::String;
use static_cell::StaticCell;

use crate::config::{WIFI_PASSWORD, WIFI_SSID};

#[embassy_executor::task]
async fn net_task(mut runner: Runner<'static, Interface>) -> ! {
	runner.run().await
}

/// The join is a task rather than a phase: the controller reconnects for the lamp's whole life,
/// which the Pico build never had.
#[embassy_executor::task]
async fn connection_task(mut controller: WifiController<'static>) -> ! {
	loop {
		match controller.connect_async().await {
			Ok(_) => {
				let _ = controller.wait_for_disconnect_async().await;
				log::warn!("wifi dropped, rejoining");
			}
			Err(e) => log::warn!("join failed: {e:?}, retrying"),
		}
		embassy_time::Timer::after_millis(5000).await;
	}
}

/// The radio and DHCP, returning once the lamp has an address.
pub async fn join(
	spawner: Spawner,
	wifi: WIFI<'static>,
	hostname: &str,
) -> embassy_net::Stack<'static> {
	let station = WifiConfig::Station(
		StationConfig::default().with_ssid(WIFI_SSID).with_password(WIFI_PASSWORD.into()),
	);
	let interface = Interface::station();
	let controller =
		WifiController::new(wifi, ControllerConfig::default().with_initial_config(station))
			.unwrap();

	let mut dhcp = DhcpConfig::default();
	dhcp.hostname = Some(String::try_from(hostname).unwrap());

	let rng = Rng::new();
	let seed = (rng.random() as u64) << 32 | rng.random() as u64;

	// One slot each for DHCP, the DDP socket and the HTTP listener, plus headroom.
	static RESOURCES: StaticCell<StackResources<6>> = StaticCell::new();
	let (stack, runner) = embassy_net::new(
		interface,
		Config::dhcpv4(dhcp),
		RESOURCES.init(StackResources::new()),
		seed,
	);

	spawner.spawn(net_task(runner).unwrap());
	spawner.spawn(connection_task(controller).unwrap());

	stack.wait_config_up().await;
	stack
}
