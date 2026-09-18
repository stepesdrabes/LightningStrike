use std::env;
use std::fs::File;
use std::io::Write;
use std::path::PathBuf;

fn main() {
	let out = PathBuf::from(env::var_os("OUT_DIR").unwrap());
	File::create(out.join("memory.x")).unwrap().write_all(include_bytes!("memory.x")).unwrap();
	println!("cargo:rustc-link-search={}", out.display());
	println!("cargo:rerun-if-changed=memory.x");

	// embassy-rp ships boot2 and link-rp.x but not memory.x, so both scripts are named here.
	println!("cargo:rustc-link-arg-bins=--nmagic");
	println!("cargo:rustc-link-arg-bins=-Tlink.x");
	println!("cargo:rustc-link-arg-bins=-Tlink-rp.x");
}
