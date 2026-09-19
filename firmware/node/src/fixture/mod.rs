//! Both fixtures expose one interface. claim returns spare peripherals as [`Board`], making pin
//! conflicts compile errors.
//!
//! [`Board`]: crate::board::Board

#[cfg(all(feature = "frame", feature = "bench"))]
compile_error!("one fixture per binary: build with --features frame or bench");
#[cfg(not(any(feature = "frame", feature = "bench")))]
compile_error!("no fixture selected: build with --features frame or bench");

#[cfg(feature = "bench")]
mod bench;
#[cfg(feature = "frame")]
mod frame;
mod rgbww;

#[cfg(feature = "bench")]
pub use bench::Fixture;
#[cfg(feature = "frame")]
pub use frame::Fixture;
