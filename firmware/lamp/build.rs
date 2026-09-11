fn main() {
	// Track baked-in credentials so changing networks invalidates the build.
	println!("cargo:rerun-if-env-changed=WIFI_SSID");
	println!("cargo:rerun-if-env-changed=WIFI_PASSWORD");
}
