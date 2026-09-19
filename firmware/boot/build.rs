use std::env;
use std::fs::File;
use std::io::Write;
use std::path::PathBuf;

fn main() {
	let out = PathBuf::from(env::var_os("OUT_DIR").unwrap());
	File::create(out.join("memory.x")).unwrap().write_all(include_bytes!("memory.x")).unwrap();
	println!("cargo:rustc-link-search={}", out.display());
	println!("cargo:rerun-if-changed=memory.x");

	// The bootloader is what the boot ROM lands on, so unlike the application it does link
	// link-rp.x and carry the boot2 stage.
	println!("cargo:rustc-link-arg-bins=--nmagic");
	println!("cargo:rustc-link-arg-bins=-Tlink.x");
	println!("cargo:rustc-link-arg-bins=-Tlink-rp.x");
}
