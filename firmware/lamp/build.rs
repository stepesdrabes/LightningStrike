fn main() {
	// Credentials are baked in through env!(), which cargo does not otherwise track. Without
	// this the lamp keeps whatever network the last build saw, silently.
	println!("cargo:rerun-if-env-changed=WIFI_SSID");
	println!("cargo:rerun-if-env-changed=WIFI_PASSWORD");
}
