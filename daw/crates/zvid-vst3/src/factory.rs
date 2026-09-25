//! The module's `IPluginFactory2`: a static object listing the one ZVID
//! Capture class.

use std::ffi::c_void;
use std::ptr;

use zvid_daw_core::{PLUGIN_NAME, VENDOR};

use crate::abi::result::{INVALID_ARGUMENT, NO_INTERFACE, OK};
use crate::abi::*;
use crate::component::Component;
use crate::{CLASS_ID, SDK_VERSION, SUB_CATEGORIES, URL, VERSION};

#[repr(C)]
struct Factory {
    vtbl: &'static IPluginFactory2Vtbl,
}

static FACTORY: Factory = Factory {
    vtbl: &FACTORY_VTBL,
};

static FACTORY_VTBL: IPluginFactory2Vtbl = IPluginFactory2Vtbl {
    unknown: FUnknownVtbl {
        query_interface: factory_query_interface,
        add_ref: factory_add_ref,
        release: factory_release,
    },
    get_factory_info: factory_get_factory_info,
    count_classes: factory_count_classes,
    get_class_info: factory_get_class_info,
    create_instance: factory_create_instance,
    get_class_info2: factory_get_class_info2,
};

/// The `IPluginFactory` `GetPluginFactory` returns. The factory is static,
/// so reference counting is a no-op.
pub fn plugin_factory() -> *mut c_void {
    ptr::from_ref(&FACTORY).cast_mut().cast()
}

unsafe extern "system" fn factory_query_interface(
    this: *mut c_void,
    iid: *const Tuid,
    obj: *mut *mut c_void,
) -> TResult {
    if obj.is_null() {
        return INVALID_ARGUMENT;
    }
    let (result, interface) = match unsafe { read_tuid(iid.cast()) } {
        Some(FUNKNOWN_IID | IPLUGIN_FACTORY_IID | IPLUGIN_FACTORY2_IID) => (OK, this),
        _ => (NO_INTERFACE, ptr::null_mut()),
    };
    unsafe { *obj = interface };
    result
}

unsafe extern "system" fn factory_add_ref(_this: *mut c_void) -> u32 {
    1
}

unsafe extern "system" fn factory_release(_this: *mut c_void) -> u32 {
    1
}

unsafe extern "system" fn factory_get_factory_info(
    _this: *mut c_void,
    info: *mut PFactoryInfo,
) -> TResult {
    let Some(info) = (unsafe { info.as_mut() }) else {
        return INVALID_ARGUMENT;
    };
    copy_cstr(&mut info.vendor, VENDOR);
    copy_cstr(&mut info.url, URL);
    copy_cstr(&mut info.email, "");
    info.flags = FACTORY_FLAG_UNICODE;
    OK
}

unsafe extern "system" fn factory_count_classes(_this: *mut c_void) -> i32 {
    1
}

unsafe extern "system" fn factory_get_class_info(
    _this: *mut c_void,
    index: i32,
    info: *mut PClassInfo,
) -> TResult {
    let Some(info) = (unsafe { info.as_mut() }).filter(|_| index == 0) else {
        return INVALID_ARGUMENT;
    };
    info.cid = CLASS_ID;
    info.cardinality = MANY_INSTANCES;
    copy_cstr(&mut info.category, AUDIO_EFFECT_CLASS);
    copy_cstr(&mut info.name, PLUGIN_NAME);
    OK
}

unsafe extern "system" fn factory_get_class_info2(
    _this: *mut c_void,
    index: i32,
    info: *mut PClassInfo2,
) -> TResult {
    let Some(info) = (unsafe { info.as_mut() }).filter(|_| index == 0) else {
        return INVALID_ARGUMENT;
    };
    info.cid = CLASS_ID;
    info.cardinality = MANY_INSTANCES;
    copy_cstr(&mut info.category, AUDIO_EFFECT_CLASS);
    copy_cstr(&mut info.name, PLUGIN_NAME);
    info.class_flags = 0;
    copy_cstr(&mut info.sub_categories, SUB_CATEGORIES);
    copy_cstr(&mut info.vendor, VENDOR);
    copy_cstr(&mut info.version, VERSION);
    copy_cstr(&mut info.sdk_version, SDK_VERSION);
    OK
}

unsafe extern "system" fn factory_create_instance(
    _this: *mut c_void,
    cid: FIDString,
    iid: FIDString,
    obj: *mut *mut c_void,
) -> TResult {
    if obj.is_null() {
        return INVALID_ARGUMENT;
    }
    if unsafe { read_tuid(cid.cast()) } != Some(CLASS_ID) {
        unsafe { *obj = ptr::null_mut() };
        return NO_INTERFACE;
    }
    unsafe { Component::create_instance(iid.cast(), obj) }
}
