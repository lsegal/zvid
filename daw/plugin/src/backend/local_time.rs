//! Local wall-clock time for capture file names, which use the time the
//! user sees rather than UTC.

use zvid_daw_core::LocalTime;

#[cfg(windows)]
pub fn now() -> LocalTime {
    // SAFETY: GetLocalTime has no preconditions.
    let time = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
    LocalTime {
        month: time.wMonth as u8,
        day: time.wDay as u8,
        hour: time.wHour as u8,
        minute: time.wMinute as u8,
        second: time.wSecond as u8,
    }
}

#[cfg(unix)]
pub fn now() -> LocalTime {
    // SAFETY: `time` accepts a null pointer, and `localtime_r` writes only
    // to the `tm` it is given.
    let tm = unsafe {
        let now = libc::time(std::ptr::null_mut());
        let mut tm: libc::tm = std::mem::zeroed();
        libc::localtime_r(&now, &mut tm);
        tm
    };
    LocalTime {
        month: (tm.tm_mon + 1) as u8,
        day: tm.tm_mday as u8,
        hour: tm.tm_hour as u8,
        minute: tm.tm_min as u8,
        second: tm.tm_sec as u8,
    }
}

#[cfg(not(any(windows, unix)))]
pub fn now() -> LocalTime {
    LocalTime {
        month: 1,
        day: 1,
        hour: 0,
        minute: 0,
        second: 0,
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn reads_a_plausible_local_time() {
        let now = super::now();
        assert!((1..=12).contains(&now.month));
        assert!((1..=31).contains(&now.day));
        assert!(now.hour < 24 && now.minute < 60 && now.second <= 60);
    }
}
