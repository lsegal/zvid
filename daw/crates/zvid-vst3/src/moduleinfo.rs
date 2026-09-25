//! `Contents/Resources/moduleinfo.json`, which lets hosts list the plugin's
//! classes without loading its binary.

use serde_json::json;
use zvid_daw_core::{PLUGIN_NAME, VENDOR};

use crate::abi::{AUDIO_EFFECT_CLASS, MANY_INSTANCES};
use crate::{CLASS_ID_WORDS, SDK_VERSION, SUB_CATEGORIES, URL, VERSION};

/// The class ID as `moduleinfo.json` writes it: the four documented words
/// in uppercase hex, the same on every platform.
pub fn class_id_string() -> String {
    CLASS_ID_WORDS
        .iter()
        .map(|word| format!("{word:08X}"))
        .collect()
}

pub fn module_info() -> String {
    let info = json!({
        "Name": PLUGIN_NAME,
        "Version": VERSION,
        "Factory Info": {
            "Vendor": VENDOR,
            "URL": URL,
            "E-Mail": "",
            "Flags": {
                "Unicode": true,
                "Classes Discardable": false,
                "Component Non Discardable": false,
            },
        },
        "Compatibility": [],
        "Classes": [{
            "CID": class_id_string(),
            "Category": AUDIO_EFFECT_CLASS,
            "Name": PLUGIN_NAME,
            "Vendor": VENDOR,
            "Version": VERSION,
            "SDKVersion": SDK_VERSION,
            "Sub Categories": SUB_CATEGORIES.split('|').collect::<Vec<_>>(),
            "Class Flags": 0,
            "Cardinality": MANY_INSTANCES,
            "Snapshots": [],
        }],
    });
    serde_json::to_string_pretty(&info).expect("module info serializes")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn describes_the_class() {
        let info: Value = serde_json::from_str(&module_info()).unwrap();
        assert_eq!(info["Name"], "ZVID Capture");
        assert_eq!(info["Factory Info"]["Vendor"], "ZVID");
        assert_eq!(info["Factory Info"]["Flags"]["Unicode"], true);
        let class = &info["Classes"][0];
        assert_eq!(class["CID"], "DC05282D436D4620B10F68451DA9BE4B");
        assert_eq!(class["Category"], "Audio Module Class");
        assert_eq!(class["Sub Categories"], serde_json::json!(["Fx", "Tools"]));
        assert_eq!(class["Cardinality"], 0x7FFF_FFFF);
        assert_eq!(class["Version"], VERSION);
    }
}
