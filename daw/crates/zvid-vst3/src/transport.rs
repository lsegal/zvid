//! Transport snapshots taken in `process()`. The control thread reads
//! changes from them with [`zvid_daw_core::TransportWatch`].

use zvid_daw_core::ProcessSnapshot;

use crate::abi::{ProcessContext, context};

/// Tempo and meter assumed when the host leaves them unset.
const DEFAULT_TEMPO: f64 = 120.0;
const DEFAULT_TIME_SIGNATURE: [u32; 2] = [4, 4];

/// The `ProcessContext` fields ZVID Capture reads, copied out of one
/// `process()` call.
pub fn snapshot(
    context: &ProcessContext,
    block: u64,
    num_samples: i32,
    host_time: f64,
) -> ProcessSnapshot {
    let has = |flag| context.state & flag != 0;
    let time_signature = if has(context::TIME_SIG_VALID)
        && context.time_sig_numerator > 0
        && context.time_sig_denominator > 0
    {
        [
            context.time_sig_numerator as u32,
            context.time_sig_denominator as u32,
        ]
    } else {
        DEFAULT_TIME_SIGNATURE
    };
    let tempo = if has(context::TEMPO_VALID) && context.tempo > 0.0 {
        context.tempo
    } else {
        DEFAULT_TEMPO
    };
    let project_time_music = if has(context::PROJECT_TIME_MUSIC_VALID) {
        context.project_time_music
    } else {
        context.project_time_samples as f64 / context.sample_rate.max(1.0) * tempo / 60.0
    };
    ProcessSnapshot {
        block,
        num_samples: u32::try_from(num_samples).unwrap_or(0),
        playing: has(context::PLAYING),
        recording: has(context::RECORDING),
        cycle_active: has(context::CYCLE_ACTIVE),
        sample_rate: context.sample_rate,
        project_time_samples: context.project_time_samples,
        project_time_music,
        tempo,
        time_signature,
        system_time_ns: has(context::SYSTEM_TIME_VALID).then_some(context.system_time),
        host_time,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BLOCK: i32 = 512;

    #[test]
    fn reads_the_process_context() {
        let context = ProcessContext {
            state: context::PLAYING
                | context::RECORDING
                | context::TEMPO_VALID
                | context::TIME_SIG_VALID,
            sample_rate: 48_000.0,
            project_time_samples: 96_000,
            tempo: 90.0,
            time_sig_numerator: 3,
            time_sig_denominator: 4,
            ..ProcessContext::default()
        };
        let snap = snapshot(&context, 1, BLOCK, 0.01);
        assert!(snap.playing);
        assert!(snap.recording);
        assert!(!snap.cycle_active);
        assert_eq!(snap.block, 1);
        assert_eq!(snap.num_samples, 512);
        assert_eq!(snap.song_sec(), 2.0);
        // No musical time from the host: derived from seconds and tempo.
        assert_eq!(snap.project_time_music, 3.0);
        assert_eq!(snap.system_time_ns, None);
        let tracker = snap.to_tracker();
        assert!(tracker.playing);
        assert_eq!(tracker.beats, 3.0);
        assert_eq!(tracker.song_sec, 2.0);
        assert_eq!(tracker.tempo, 90.0);
        assert_eq!(tracker.time_signature, [3, 4]);
        assert_eq!(tracker.host_time, 0.01);
    }

    #[test]
    fn reads_the_loop_flag() {
        let context = ProcessContext {
            state: context::PLAYING | context::CYCLE_ACTIVE,
            ..ProcessContext::default()
        };
        assert!(snapshot(&context, 1, BLOCK, 0.0).cycle_active);
    }

    #[test]
    fn falls_back_when_fields_are_invalid() {
        let context = ProcessContext {
            state: context::SYSTEM_TIME_VALID | context::PROJECT_TIME_MUSIC_VALID,
            sample_rate: 44_100.0,
            project_time_music: 8.5,
            system_time: 42,
            tempo: 150.0,
            ..ProcessContext::default()
        };
        let snap = snapshot(&context, 1, -1, 0.0);
        assert_eq!(snap.tempo, DEFAULT_TEMPO);
        assert_eq!(snap.time_signature, DEFAULT_TIME_SIGNATURE);
        assert_eq!(snap.project_time_music, 8.5);
        assert_eq!(snap.system_time_ns, Some(42));
        assert_eq!(snap.num_samples, 0);
    }
}
