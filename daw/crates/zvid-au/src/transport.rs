//! Turns what an AU host reports through its `HostCallbacks` into the core
//! [`TransportSnapshot`].

use zvid_daw_core::TransportSnapshot;

/// Tempo assumed when the host reports none.
pub const DEFAULT_TEMPO: f64 = 120.0;
/// Time signature assumed when the host reports none.
pub const DEFAULT_TIME_SIGNATURE: [u32; 2] = [4, 4];

/// Values read from the host callbacks during one render call. `None` means
/// the host did not provide the callback or it failed.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct HostReading {
    /// From `transportStateProc2` (or `transportStateProc`).
    pub playing: Option<bool>,
    /// Transport position in samples, from the transport state callback.
    pub sample_in_timeline: Option<f64>,
    /// Current beat, from `beatAndTempoProc`.
    pub beat: Option<f64>,
    /// Tempo in BPM, from `beatAndTempoProc`.
    pub tempo: Option<f64>,
    /// From `musicalTimeLocationProc`.
    pub time_signature: Option<[u32; 2]>,
}

/// A snapshot for the take tracker, or `None` when the host reported no
/// transport at all.
pub fn snapshot(
    reading: HostReading,
    sample_rate: f64,
    host_time: f64,
) -> Option<TransportSnapshot> {
    if reading.playing.is_none() && reading.beat.is_none() && reading.sample_in_timeline.is_none() {
        return None;
    }
    let tempo = reading
        .tempo
        .filter(|tempo| tempo.is_finite() && *tempo > 0.0)
        .unwrap_or(DEFAULT_TEMPO);
    // The sample position is exact across tempo changes; beats are only a
    // fallback for hosts that report no position.
    let song_sec = match reading.sample_in_timeline {
        Some(samples) if sample_rate > 0.0 => samples / sample_rate,
        _ => reading.beat.unwrap_or(0.0) * 60.0 / tempo,
    };
    let beats = reading.beat.unwrap_or(song_sec * tempo / 60.0);
    let time_signature = reading
        .time_signature
        .filter(|[numerator, denominator]| *numerator > 0 && *denominator > 0)
        .unwrap_or(DEFAULT_TIME_SIGNATURE);
    Some(TransportSnapshot {
        playing: reading.playing.unwrap_or(false),
        beats,
        song_sec,
        tempo,
        time_signature,
        host_time,
    })
}

/// Converts a Mach host-time tick count to seconds using the host's
/// `mach_timebase_info` ratio.
pub fn host_ticks_to_sec(ticks: u64, numer: u32, denom: u32) -> f64 {
    ticks as f64 * f64::from(numer) / f64::from(denom.max(1)) / 1e9
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_reported_gives_no_snapshot() {
        assert_eq!(snapshot(HostReading::default(), 48_000.0, 1.0), None);
    }

    #[test]
    fn uses_sample_position_for_song_time() {
        let reading = HostReading {
            playing: Some(true),
            sample_in_timeline: Some(96_000.0),
            beat: Some(4.0),
            tempo: Some(120.0),
            time_signature: Some([3, 4]),
        };
        assert_eq!(
            snapshot(reading, 48_000.0, 7.5),
            Some(TransportSnapshot {
                playing: true,
                beats: 4.0,
                song_sec: 2.0,
                tempo: 120.0,
                time_signature: [3, 4],
                host_time: 7.5,
            })
        );
    }

    #[test]
    fn falls_back_to_beats_and_defaults() {
        let reading = HostReading {
            beat: Some(8.0),
            tempo: Some(0.0),
            time_signature: Some([0, 4]),
            ..HostReading::default()
        };
        let snapshot = snapshot(reading, 44_100.0, 0.0).unwrap();
        assert!(!snapshot.playing);
        assert_eq!(snapshot.tempo, DEFAULT_TEMPO);
        assert_eq!(snapshot.song_sec, 4.0);
        assert_eq!(snapshot.beats, 8.0);
        assert_eq!(snapshot.time_signature, DEFAULT_TIME_SIGNATURE);
    }

    #[test]
    fn derives_beats_from_position() {
        let reading = HostReading {
            playing: Some(false),
            sample_in_timeline: Some(44_100.0),
            tempo: Some(90.0),
            ..HostReading::default()
        };
        let snapshot = snapshot(reading, 44_100.0, 0.0).unwrap();
        assert_eq!(snapshot.song_sec, 1.0);
        assert_eq!(snapshot.beats, 1.5);
    }

    #[test]
    fn converts_host_ticks() {
        // Apple silicon: 125/3 ns per tick.
        assert_eq!(host_ticks_to_sec(24_000_000, 125, 3), 1.0);
        // Intel: 1 ns per tick.
        assert_eq!(host_ticks_to_sec(2_500_000_000, 1, 1), 2.5);
    }
}
