use super::*;
use serde_json::json;

const FILE: &str = "video-01-9-25-20-36-12-0.mp4";

fn capture() -> Capture {
    Capture {
        filename: FILE.to_string(),
        dimensions: [1920, 1080],
        fps: [30, 1],
        camera: "FaceTime HD Camera".to_string(),
        created_at: "2026-09-25T20:36:12Z".to_string(),
    }
}

fn arm(at: f64) -> Command {
    Command::Arm {
        capture: capture(),
        at,
    }
}

/// A snapshot at 120 BPM in 4/4, where beats are twice the song seconds.
fn snap(playing: bool, song_sec: f64, host_time: f64) -> TransportSnapshot {
    TransportSnapshot {
        playing,
        beats: song_sec * 2.0,
        song_sec,
        tempo: 120.0,
        time_signature: [4, 4],
        host_time,
    }
}

/// Plays from `song_sec` at host time `from` for `seconds`, one snapshot
/// every 10 ms, then stops.
fn play(log: &mut TakeLog, state: &mut State, song_sec: f64, from: f64, seconds: f64) {
    let steps = (seconds * 100.0).round() as u32;
    for step in 0..=steps {
        let elapsed = f64::from(step) / 100.0;
        log.transport(snap(true, song_sec + elapsed, from + elapsed), state);
    }
    log.transport(snap(false, song_sec + seconds, from + seconds + 0.01), state);
}

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() < 0.011
}

#[test]
fn three_play_spans_become_three_takes_of_one_file() {
    let mut log = TakeLog::default();
    let mut state = State::default();
    log.command(arm(100.0), &mut state);
    log.transport(snap(false, 0.0, 100.5), &mut state);
    play(&mut log, &mut state, 8.0, 101.0, 2.0);
    play(&mut log, &mut state, 16.0, 105.0, 1.0);
    play(&mut log, &mut state, 32.0, 110.0, 3.0);
    log.command(Command::Disarm { at: 115.0 }, &mut state);

    let takes = &state.recordings;
    assert_eq!(takes.len(), 3);
    assert!(takes.iter().all(|take| take.filename == FILE));
    let ids: Vec<&str> = takes.iter().map(|take| take.id.as_str()).collect();
    assert_eq!(
        ids,
        [
            "video-01-9-25-20-36-12-0-take-1",
            "video-01-9-25-20-36-12-0-take-2",
            "video-01-9-25-20-36-12-0-take-3",
        ]
    );
    for (take, (offset, start, duration)) in
        takes
            .iter()
            .zip([(1.0, 8.0, 2.0), (5.0, 16.0, 1.0), (10.0, 32.0, 3.0)])
    {
        assert!(close(take.file_offset_sec, offset), "{take:?}");
        assert_eq!(take.transport_start_sec, Some(start));
        assert_eq!(take.transport_start_beats, Some(start * 2.0));
        assert!(close(take.duration_sec, duration), "{take:?}");
        assert_eq!(take.tempo, Some(120.0));
        assert_eq!(take.time_signature, Some([4, 4]));
        // File frame 0 sits `offset` seconds before the take's position.
        assert_eq!(
            take.frame_start,
            (start * 30.0).round() as i64 - (take.file_offset_sec * 30.0).round() as i64
        );
        assert_eq!(take.dimensions, [1920, 1080]);
        assert_eq!(take.fps, [30, 1]);
        assert_eq!(take.camera, "FaceTime HD Camera");
    }
    assert!(!log.is_armed());
}

#[test]
fn each_loop_pass_is_a_take() {
    let mut log = TakeLog::default();
    let mut state = State::default();
    log.command(arm(0.0), &mut state);
    // Four bars of 4/4 at 120 BPM are 8 s. Two passes, then stop.
    for pass in 0..2 {
        for step in 0..800 {
            let elapsed = f64::from(step) / 100.0;
            let host_time = 1.0 + f64::from(pass) * 8.0 + elapsed;
            log.transport(snap(true, elapsed, host_time), &mut state);
        }
    }
    log.transport(snap(false, 0.0, 17.0), &mut state);
    log.command(Command::Disarm { at: 18.0 }, &mut state);

    assert_eq!(state.recordings.len(), 2);
    for (take, offset) in state.recordings.iter().zip([1.0, 9.0]) {
        assert_eq!(take.transport_start_sec, Some(0.0));
        assert!(close(take.file_offset_sec, offset), "{take:?}");
        assert!(close(take.duration_sec, 8.0), "{take:?}");
    }
}

#[test]
fn arming_during_playback_starts_a_take_at_arm() {
    let mut log = TakeLog::default();
    let mut state = State::default();
    log.transport(snap(true, 20.0, 50.0), &mut state);
    let events = log.command(arm(50.5), &mut state);
    assert_eq!(events.len(), 1);
    assert_eq!(state.recordings.len(), 1);
    let take = &state.recordings[0];
    assert_eq!(take.file_offset_sec, 0.0);
    assert_eq!(take.transport_start_sec, Some(20.5));
    assert_eq!(take.frame_start, 615);
}

#[test]
fn a_capture_without_playback_is_one_unanchored_entry() {
    let mut log = TakeLog::default();
    let mut state = State::default();
    log.command(arm(10.0), &mut state);
    log.transport(snap(false, 4.0, 11.0), &mut state);
    let events = log.command(Command::Disarm { at: 22.5 }, &mut state);
    assert_eq!(events.len(), 2);
    assert_eq!(state.recordings.len(), 1);
    let take = &state.recordings[0];
    assert!(take.is_unanchored());
    assert_eq!(take.file_offset_sec, 0.0);
    assert_eq!(take.duration_sec, 12.5);
    assert_eq!(take.frame_start, 0);
    assert_eq!(take.filename, FILE);
}

#[test]
fn an_open_take_is_in_the_state_with_its_running_duration() {
    let mut log = TakeLog::default();
    let mut state = State::default();
    log.command(arm(0.0), &mut state);
    let events = log.transport(snap(true, 4.0, 1.0), &mut state);
    assert!(matches!(events[..], [Event::TakeOpened(_)]));
    assert_eq!(state.recordings.len(), 1);
    assert_eq!(state.recordings[0].duration_sec, 0.0);

    assert!(log.transport(snap(true, 6.5, 3.5), &mut state).is_empty());
    assert_eq!(state.recordings[0].duration_sec, 2.5);

    // A later version's key survives the take closing.
    state.recordings[0]
        .extra
        .insert("rotation".to_string(), json!(90));
    let events = log.transport(snap(false, 7.0, 4.0), &mut state);
    assert!(matches!(events[..], [Event::TakeClosed(_)]));
    assert_eq!(state.recordings.len(), 1);
    assert_eq!(state.recordings[0].duration_sec, 3.0);
    assert_eq!(state.recordings[0].extra["rotation"], 90);

    // Snapshots after the take closed leave it alone.
    log.transport(snap(false, 7.0, 5.0), &mut state);
    assert_eq!(state.recordings[0].duration_sec, 3.0);
}

#[test]
fn frame_clocks_place_takes_in_file_time() {
    let mut log = TakeLog::default();
    let mut state = State::default();
    log.command(arm(10.0), &mut state);
    // The first frame, captured at 10.2 s, is file time zero.
    log.command(
        Command::FrameClock {
            host_time: 10.2,
            file_sec: 0.0,
        },
        &mut state,
    );
    log.transport(snap(true, 2.0, 12.2), &mut state);
    log.transport(snap(false, 3.0, 13.2), &mut state);
    let take = &state.recordings[0];
    assert!(close(take.file_offset_sec, 2.0));
    assert!(close(take.duration_sec, 1.0));
}

#[test]
fn arming_twice_keeps_the_first_capture() {
    let mut log = TakeLog::default();
    let mut state = State::default();
    log.command(arm(0.0), &mut state);
    let other = Capture {
        filename: "video-02-9-25-20-40-00-0.mp4".to_string(),
        ..capture()
    };
    assert!(
        log.command(
            Command::Arm {
                capture: other,
                at: 1.0
            },
            &mut state
        )
        .is_empty()
    );
    log.command(Command::Disarm { at: 2.0 }, &mut state);
    assert_eq!(state.recordings[0].filename, FILE);
}

#[test]
fn a_take_survives_the_state_being_replaced_mid_take() {
    let mut log = TakeLog::default();
    let mut state = State::default();
    log.command(arm(0.0), &mut state);
    log.transport(snap(true, 0.0, 1.0), &mut state);
    state = State::default();
    log.transport(snap(false, 2.0, 3.0), &mut state);
    assert_eq!(state.recordings.len(), 1);
    assert_eq!(state.recordings[0].duration_sec, 2.0);
}

#[test]
fn separate_captures_get_their_own_take_ids() {
    let mut log = TakeLog::default();
    let mut state = State::default();
    log.command(arm(0.0), &mut state);
    log.command(Command::Disarm { at: 1.0 }, &mut state);
    log.command(
        Command::Arm {
            capture: Capture {
                filename: "video-02-9-25-20-40-00-0.mp4".to_string(),
                ..capture()
            },
            at: 2.0,
        },
        &mut state,
    );
    log.command(Command::Disarm { at: 3.0 }, &mut state);
    let ids: Vec<&str> = state
        .recordings
        .iter()
        .map(|take| take.id.as_str())
        .collect();
    assert_eq!(
        ids,
        [
            "video-01-9-25-20-36-12-0-take-1",
            "video-02-9-25-20-40-00-0-take-1",
        ]
    );
}
