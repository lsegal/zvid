//! Identity of the ZVID Capture Audio Unit and the `Info.plist` that
//! registers it. Shared by the plugin and by `cargo xtask bundle`.

/// `aufx`: an effect, so Live inserts it on an audio track.
pub const TYPE: [u8; 4] = *b"aufx";
pub const SUBTYPE: [u8; 4] = *b"ZVcp";
pub const MANUFACTURER: [u8; 4] = *b"ZVID";
/// Registered component name, `"<manufacturer>: <plugin>"`.
pub const NAME: &str = "ZVID: ZVID Capture";
pub const DESCRIPTION: &str = "Transport-following webcam capture";
pub const BUNDLE_ID: &str = "cc.zvid.capture.component";
/// Exported symbol named by the `factoryFunction` plist key.
pub const FACTORY_FUNCTION: &str = "ZVIDCaptureAUFactory";
/// Bundle executable name inside `Contents/MacOS`.
pub const EXECUTABLE: &str = zvid_daw_core::PLUGIN_NAME;
/// Objective-C class of the Cocoa view factory.
pub const VIEW_FACTORY_CLASS: &str = "ZVIDCaptureAUViewFactory";
/// ClassInfo dictionary key holding the core state JSON.
pub const STATE_KEY: &str = "zvid-state";

/// A four-character code as the big-endian `OSType` the AU APIs use.
pub const fn four_cc(code: [u8; 4]) -> u32 {
    u32::from_be_bytes(code)
}

/// The AU component version, `0xMMMMmmbb`, for a `major.minor.patch`
/// version string. Missing or non-numeric parts count as zero.
pub fn version_number(version: &str) -> u32 {
    let mut parts = version
        .split(['.', '-', '+'])
        .map(|part| part.parse::<u32>().unwrap_or(0));
    let major = parts.next().unwrap_or(0).min(0xFFFF);
    let minor = parts.next().unwrap_or(0).min(0xFF);
    let patch = parts.next().unwrap_or(0).min(0xFF);
    (major << 16) | (minor << 8) | patch
}

/// The bundle's `Info.plist`, with the `AudioComponents` entry that makes
/// the component discoverable.
pub fn info_plist(version: &str) -> String {
    let type_code = code_str(TYPE);
    let subtype_code = code_str(SUBTYPE);
    let manufacturer_code = code_str(MANUFACTURER);
    let component_version = version_number(version);
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>English</string>
	<key>CFBundleExecutable</key>
	<string>{EXECUTABLE}</string>
	<key>CFBundleIdentifier</key>
	<string>{BUNDLE_ID}</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>{EXECUTABLE}</string>
	<key>CFBundlePackageType</key>
	<string>BNDL</string>
	<key>CFBundleShortVersionString</key>
	<string>{version}</string>
	<key>CFBundleSignature</key>
	<string>????</string>
	<key>CFBundleVersion</key>
	<string>{version}</string>
	<key>AudioComponents</key>
	<array>
		<dict>
			<key>type</key>
			<string>{type_code}</string>
			<key>subtype</key>
			<string>{subtype_code}</string>
			<key>manufacturer</key>
			<string>{manufacturer_code}</string>
			<key>name</key>
			<string>{NAME}</string>
			<key>description</key>
			<string>{DESCRIPTION}</string>
			<key>version</key>
			<integer>{component_version}</integer>
			<key>factoryFunction</key>
			<string>{FACTORY_FUNCTION}</string>
			<key>sandboxSafe</key>
			<true/>
			<key>tags</key>
			<array>
				<string>Effects</string>
			</array>
		</dict>
	</array>
</dict>
</plist>
"#
    )
}

fn code_str(code: [u8; 4]) -> String {
    String::from_utf8_lossy(&code).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn four_cc_is_big_endian() {
        assert_eq!(four_cc(*b"aufx"), 0x6175_6678);
        assert_eq!(four_cc(MANUFACTURER), 0x5A56_4944);
    }

    #[test]
    fn version_number_packs_major_minor_patch() {
        assert_eq!(version_number("0.1.0"), 0x0000_0100);
        assert_eq!(version_number("1.2.3"), 0x0001_0203);
        assert_eq!(version_number("2.0.1-beta.1"), 0x0002_0001);
        assert_eq!(version_number("3"), 0x0003_0000);
    }

    #[test]
    fn info_plist_registers_the_component() {
        let plist = info_plist("0.1.0");
        for expected in [
            "<string>aufx</string>",
            "<string>ZVcp</string>",
            "<string>ZVID</string>",
            "<string>ZVID: ZVID Capture</string>",
            "<key>sandboxSafe</key>\n\t\t\t<true/>",
            "<integer>256</integer>",
            "<string>ZVIDCaptureAUFactory</string>",
            "<key>CFBundleExecutable</key>\n\t<string>ZVID Capture</string>",
            "<key>CFBundleIdentifier</key>\n\t<string>cc.zvid.capture.component</string>",
        ] {
            assert!(plist.contains(expected), "missing {expected:?} in\n{plist}");
        }
    }
}
