//! Letting the webview draw as fast as the display can.
//!
//! WKWebView paces `requestAnimationFrame` at 60 Hz whatever the panel is capable of, which on a
//! ProMotion Mac is half of what the room could be shown at. Safari does not, because the setting
//! that governs it - `PreferPageRenderingUpdatesNear60FPSEnabled` - is honoured for Safari and not
//! for an embedded webview. WebKit bug 294338 has been open on exactly that since June 2025, and
//! no public API exposes the preference. The only route is the one Safari itself uses.
//!
//! So this is a private API, deliberately: `+[WKPreferences _features]` for the catalogue and
//! `-[WKPreferences _setEnabled:forFeature:]` to spend it. It matters less here than it would
//! elsewhere - the app is unsigned and runs on the machine that built it, so there is no review to
//! fail - but it is still a selector Apple never promised. Every call is guarded, and if any of
//! them ever goes away the room draws at 60 again, which is what it did before this existed.
//!
//! The catalogue is a CLASS method while the setter is an instance one, and that asymmetry is the
//! whole trap: asking the preferences object whether it responds to `_features` says no, which
//! reads exactly like a feature that has been withdrawn. It has not - there are 579 of them on
//! macOS 26.3, and this is one.

#[cfg(target_os = "macos")]
use objc2::rc::Retained;
#[cfg(target_os = "macos")]
use objc2::runtime::{AnyObject, Bool, Sel};
#[cfg(target_os = "macos")]
use objc2::{msg_send, sel};
#[cfg(target_os = "macos")]
use objc2_foundation::NSString;

#[cfg(target_os = "macos")]
const FEATURE: &str = "PreferPageRenderingUpdatesNear60FPSEnabled";

/// Whether the cap was found and lifted. False means the room stays at 60, not that anything broke.
#[cfg(target_os = "macos")]
pub fn unlock(webview: *mut std::ffi::c_void) -> bool {
	if webview.is_null() {
		return false;
	}
	unsafe {
		let webview: *mut AnyObject = webview.cast();
		let config: *mut AnyObject = msg_send![webview, configuration];
		let preferences: *mut AnyObject = msg_send![config, preferences];
		if !responds(preferences, sel!(_setEnabled:forFeature:)) {
			return false;
		}

		let class: *mut AnyObject = msg_send![preferences, class];
		if !responds(class, sel!(_features)) {
			return false;
		}
		let features: *mut AnyObject = msg_send![class, _features];
		if features.is_null() {
			return false;
		}

		let wanted = NSString::from_str(FEATURE);
		let count: usize = msg_send![features, count];
		for i in 0..count {
			let feature: *mut AnyObject = msg_send![features, objectAtIndex: i];
			if !responds(feature, sel!(key)) {
				continue;
			}
			let key: Option<Retained<NSString>> = msg_send![feature, key];
			let Some(key) = key else { continue };
			let same: Bool = msg_send![&*key, isEqualToString: &*wanted];
			if same.as_bool() {
				let _: () = msg_send![preferences, _setEnabled: false, forFeature: feature];
				return true;
			}
		}
	}
	false
}

/// True for an instance method on an object, or for a class method when handed the class itself.
#[cfg(target_os = "macos")]
unsafe fn responds(object: *mut AnyObject, selector: Sel) -> bool {
	if object.is_null() {
		return false;
	}
	let answers: Bool = unsafe { msg_send![object, respondsToSelector: selector] };
	answers.as_bool()
}
