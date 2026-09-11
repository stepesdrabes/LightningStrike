//! Lift WKWebView's 60 Hz cap via guarded private selectors (WebKit bug 294338). Missing selectors
//! leave the 60 Hz fallback intact. _features is a class method; _setEnabled:forFeature: is an
//! instance method.

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
