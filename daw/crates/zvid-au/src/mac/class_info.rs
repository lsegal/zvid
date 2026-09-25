//! `kAudioUnitProperty_ClassInfo`: the property-list dictionary a host saves
//! with the set (Live keeps it in the `.als`). The core state JSON rides in it
//! as data under [`STATE_KEY`].

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_audio_toolbox::kAudioUnitErr_InvalidPropertyValue;
use objc2_foundation::{NSData, NSDictionary, NSMutableDictionary, NSNumber, NSObject, NSString};
use zvid_daw_core::State;

use crate::component::{MANUFACTURER, STATE_KEY, SUBTYPE, TYPE, four_cc};

// Standard `AUPreset` keys (`kAUPreset*Key`).
const VERSION_KEY: &str = "version";
const TYPE_KEY: &str = "type";
const SUBTYPE_KEY: &str = "subtype";
const MANUFACTURER_KEY: &str = "manufacturer";
const NAME_KEY: &str = "name";
/// ClassInfo format version; the only one AudioToolbox defines.
const CLASS_INFO_VERSION: i32 = 0;

/// Builds the ClassInfo dictionary for `state`.
pub fn save(
    state: &State,
    preset_name: &NSString,
) -> Retained<NSMutableDictionary<NSString, NSObject>> {
    let dictionary = NSMutableDictionary::<NSString, NSObject>::new();
    let insert = |key: &str, value: &NSObject| dictionary.insert(&*NSString::from_str(key), value);
    insert(VERSION_KEY, &NSNumber::new_i32(CLASS_INFO_VERSION));
    // AudioToolbox stores the four-character codes as signed 32-bit numbers.
    insert(TYPE_KEY, &NSNumber::new_i32(four_cc(TYPE) as i32));
    insert(SUBTYPE_KEY, &NSNumber::new_i32(four_cc(SUBTYPE) as i32));
    insert(
        MANUFACTURER_KEY,
        &NSNumber::new_i32(four_cc(MANUFACTURER) as i32),
    );
    insert(NAME_KEY, preset_name);
    insert(STATE_KEY, &NSData::with_bytes(state.to_json().as_bytes()));
    dictionary
}

/// What a ClassInfo dictionary restores.
pub struct Restored {
    /// `None` when the dictionary carries no ZVID state, such as a preset
    /// saved before the plugin had any.
    pub state: Option<State>,
    pub preset_name: Option<Retained<NSString>>,
}

/// Reads a ClassInfo dictionary, rejecting one saved by another component.
pub fn restore(object: &AnyObject) -> Result<Restored, i32> {
    let invalid = kAudioUnitErr_InvalidPropertyValue;
    let dictionary = object.downcast_ref::<NSDictionary>().ok_or(invalid)?;
    let get = |key: &str| dictionary.objectForKey(&NSString::from_str(key));
    let number = |key: &str| {
        get(key)
            .and_then(|value| value.downcast::<NSNumber>().ok())
            .map(|value| value.as_i64())
    };
    if number(VERSION_KEY) != Some(i64::from(CLASS_INFO_VERSION)) {
        return Err(invalid);
    }
    for (key, code) in [
        (TYPE_KEY, TYPE),
        (SUBTYPE_KEY, SUBTYPE),
        (MANUFACTURER_KEY, MANUFACTURER),
    ] {
        // Accept the code whether the writer stored it signed or unsigned.
        let matches = number(key).is_some_and(|value| value as u32 == four_cc(code));
        if !matches {
            return Err(invalid);
        }
    }
    let state = match get(STATE_KEY) {
        None => None,
        Some(value) => {
            let data = value.downcast::<NSData>().map_err(|_| invalid)?;
            let json = String::from_utf8(data.to_vec()).map_err(|_| invalid)?;
            Some(State::from_json(&json).map_err(|_| invalid)?)
        }
    };
    let preset_name = get(NAME_KEY).and_then(|value| value.downcast::<NSString>().ok());
    Ok(Restored { state, preset_name })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_state() {
        let mut state = State::default();
        state
            .extra
            .insert("future".into(), serde_json::Value::Bool(true));
        let saved = save(&state, &NSString::from_str("Take setup"));
        let restored = restore(&saved).unwrap();
        assert_eq!(restored.state, Some(state));
        assert_eq!(restored.preset_name.unwrap().to_string(), "Take setup");
    }

    #[test]
    fn rejects_another_components_class_info() {
        let saved = save(&State::default(), &NSString::from_str("Untitled"));
        saved.insert(&*NSString::from_str(SUBTYPE_KEY), &NSNumber::new_i32(1));
        assert_eq!(
            restore(&saved).err(),
            Some(kAudioUnitErr_InvalidPropertyValue)
        );
    }

    #[test]
    fn accepts_class_info_without_state() {
        let saved = save(&State::default(), &NSString::from_str("Untitled"));
        saved.removeObjectForKey(&NSString::from_str(STATE_KEY));
        assert_eq!(restore(&saved).unwrap().state, None);
    }
}
