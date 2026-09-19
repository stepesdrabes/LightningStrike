//! Board-independent wire formats, host-testable without Embassy. hardware.ts parses emitted strings.

#![no_std]

pub mod ddp;
pub mod frame;
pub mod hello;
pub mod pack;
pub mod stats;
