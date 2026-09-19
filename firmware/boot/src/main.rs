//! The Frame's A/B bootloader.
//!
//! The boot ROM lands here. If the application marked a fresh image in DFU, swap the two slots
//! before handing over; if the image that was swapped in never confirmed itself, swap them back.
//! `FIRMWARE.md` has the whole trial.
//!
//! `WatchdogFlash` feeds the watchdog on every flash operation, which is what makes a 768 KB
//! swap survivable under an 8 s window.

#![no_std]
#![no_main]

use core::cell::RefCell;

use cortex_m_rt::entry;
use embassy_boot_rp::{BootLoader, BootLoaderConfig, WatchdogFlash};
use embassy_sync::blocking_mutex::Mutex;
use embassy_sync::blocking_mutex::raw::NoopRawMutex;
use embassy_time::Duration;

// A bootloader that hangs can only be recovered over USB, so a panic resets instead.
use panic_reset as _;

const FLASH_SIZE: usize = 2 * 1024 * 1024;

/// The application has this long from the hand-over to start feeding, and it is also the ceiling
/// on one flash operation during a swap.
const WATCHDOG_TIMEOUT: Duration = Duration::from_secs(8);

/// Flashing the bootloader clears the state sector with it. Without this the sector keeps
/// whatever the pre-A/B firmware left at 0x6000, and a byte that happens to read as the swap
/// magic would make the very first boot swap stale flash into ACTIVE.
#[used]
#[unsafe(link_section = ".bootloader_state")]
static STATE_INIT: [u8; 4096] = [0xff; 4096];

#[entry]
fn main() -> ! {
	let p = embassy_rp::init(Default::default());

	let flash = WatchdogFlash::<FLASH_SIZE>::start(p.FLASH, p.WATCHDOG, WATCHDOG_TIMEOUT);
	let flash = Mutex::<NoopRawMutex, _>::new(RefCell::new(flash));

	let config = BootLoaderConfig::from_linkerfile_blocking(&flash, &flash, &flash);
	let active = embassy_rp::flash::FLASH_BASE as u32 + config.active.offset();

	// `prepare` panics on a flash error, and panic-reset re-enters here. That is the right
	// answer rather than a trap: the swap records its progress per page, so the retry resumes
	// where it stopped, while booting a half-swapped ACTIVE would jump into rubble.
	let loader: BootLoader = BootLoader::prepare(config);

	// Do not mask interrupts around this. `load` is a jump, not a reset, so PRIMASK would
	// survive into the application, where nothing clears it: the executor would then never
	// see a timer or a USB interrupt again. Measured on the board, 2026-09-19.
	unsafe { loader.load(active) }
}
