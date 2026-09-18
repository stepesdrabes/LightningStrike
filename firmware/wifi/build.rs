use std::path::PathBuf;
use std::{env, fs};

fn main() {
	let root = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap());
	// One list beside both board crates, so the two boards cannot disagree about a network.
	let list = root.parent().unwrap().join("wifi.toml");
	println!("cargo:rerun-if-changed={}", list.display());

	let text = fs::read_to_string(&list).unwrap_or_else(|e| {
		panic!(
			"cannot read {}: {e}. Copy firmware/wifi.toml.example to firmware/wifi.toml and put \
			 your networks in it",
			list.display()
		)
	});

	let doc: toml::Table = toml::from_str(&text).expect("firmware/wifi.toml is not valid TOML");
	let networks = doc
		.get("network")
		.and_then(|v| v.as_array())
		.filter(|a| !a.is_empty())
		.expect("firmware/wifi.toml needs at least one [[network]] table");

	// The button counts from one, and a u8 index is what the settings store holds.
	assert!(networks.len() <= 9, "firmware/wifi.toml: at most nine networks, one blink each");

	let mut out = format!("pub static NETWORKS: [Network; {}] = [\n", networks.len());
	for (i, network) in networks.iter().enumerate() {
		let field = |name: &str| -> String {
			let value = network.get(name).and_then(|v| v.as_str()).unwrap_or_else(|| {
				panic!("firmware/wifi.toml: [[network]] {} has no {name} string", i + 1)
			});
			// Debug for str is exactly a Rust string literal, quotes and escapes included.
			format!("{value:?}")
		};
		out.push_str(&format!(
			"\tNetwork {{ ssid: {}, password: {} }},\n",
			field("ssid"),
			field("password")
		));
	}
	out.push_str("];\n");

	let generated = PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("networks.rs");
	fs::write(&generated, out).unwrap();
}
