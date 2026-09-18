use embassy_executor::Spawner;
use embassy_futures::select::{Either, select};
use embassy_net::{Config, DhcpConfig, Runner, StackResources};
use embassy_time::Timer;
use esp_hal::peripherals::{GPIO9, WIFI};
use esp_hal::rng::Rng;
use esp_radio::wifi::sta::StationConfig;
use esp_radio::wifi::{Config as WifiConfig, ControllerConfig, Interface, WifiController};
use heapless::String;
use room_wifi::Network;
use static_cell::StaticCell;

use crate::select;
use crate::status::{Status, status_task};

/// Gap between join attempts, and therefore also how soon a press taken mid-retry is acted on.
const RETRY_MS: u64 = 5_000;

fn station(network: &Network) -> WifiConfig {
	WifiConfig::Station(
		StationConfig::default().with_ssid(network.ssid).with_password(network.password.into()),
	)
}

#[embassy_executor::task]
async fn net_task(mut runner: Runner<'static, Interface>) -> ! {
	runner.run().await
}

/// The radio for the lamp's whole life: it holds the chosen network, rejoins when it drops,
/// and moves when the button settles somewhere else.
#[embassy_executor::task]
async fn connection_task(mut controller: WifiController<'static>, index: u8) -> ! {
	let mut network = room_wifi::network(index);
	loop {
		log::info!("joining {}", network.ssid);
		let next = loop {
			match controller.connect_async().await {
				Ok(_) => {
					let event =
						select(controller.wait_for_disconnect_async(), select::wait_switch()).await;
					match event {
						Either::First(_) => log::warn!("wifi dropped, rejoining {}", network.ssid),
						Either::Second(next) => break next,
					}
				}
				Err(e) => {
					log::warn!("join {} failed: {e:?}, retrying", network.ssid);
					let event = select(Timer::after_millis(RETRY_MS), select::wait_switch()).await;
					if let Either::Second(next) = event {
						break next;
					}
				}
			}
		};

		log::info!("switching to wifi {}", next + 1);
		let _ = controller.disconnect_async().await;
		network = room_wifi::network(next);
		if let Err(e) = controller.set_config(&station(network)) {
			log::warn!("wifi config failed: {e:?}");
		}
	}
}

/// The radio and DHCP, returning once the lamp has an address. The button task starts first
/// of all, because a board that cannot join is a board that needs it.
pub async fn join(
	spawner: Spawner,
	wifi: WIFI<'static>,
	button: GPIO9<'static>,
	hostname: &str,
	status: Status,
	index: u8,
) -> embassy_net::Stack<'static> {
	spawner.spawn(select::poll_task(button, index).unwrap());

	let interface = Interface::station();
	let controller = WifiController::new(
		wifi,
		ControllerConfig::default().with_initial_config(station(room_wifi::network(index))),
	)
	.unwrap();

	let mut dhcp = DhcpConfig::default();
	dhcp.hostname = Some(String::try_from(hostname).unwrap());

	let rng = Rng::new();
	let seed = (rng.random() as u64) << 32 | rng.random() as u64;

	// One slot each for DHCP, the DDP socket and the two HTTP listeners, plus headroom.
	static RESOURCES: StaticCell<StackResources<8>> = StaticCell::new();
	let (stack, runner) = embassy_net::new(
		interface,
		Config::dhcpv4(dhcp),
		RESOURCES.init(StackResources::new()),
		seed,
	);

	spawner.spawn(net_task(runner).unwrap());
	spawner.spawn(connection_task(controller, index).unwrap());
	spawner.spawn(status_task(status, stack, index).unwrap());

	stack.wait_config_up().await;
	stack
}
