use super::*;

const SIG: [u32; 2] = [4, 4];

/// A snapshot at 120 BPM, where beats are twice the song seconds.
fn transport(playing: bool, song_sec: f64, host_time: f64) -> Input {
    Input::Transport(TransportSnapshot {
        playing,
        beats: song_sec * 2.0,
        song_sec,
        tempo: 120.0,
        time_signature: SIG,
        host_time,
    })
}

fn anchor(song_sec: f64) -> Option<Anchor> {
    Some(Anchor {
        transport_start_sec: song_sec,
        transport_start_beats: song_sec * 2.0,
        tempo: 120.0,
        time_signature: SIG,
    })
}

fn take(index: u32, file_offset_sec: f64, anchor: Option<Anchor>, duration_sec: f64) -> Take {
    Take {
        index,
        file_offset_sec,
        anchor,
        duration_sec,
    }
}

fn run(tracker: &mut TakeTracker, inputs: &[Input]) -> Vec<Event> {
    inputs
        .iter()
        .flat_map(|input| tracker.handle(*input))
        .collect()
}

#[test]
fn arm_play_stop_disarm() {
    let mut tracker = TakeTracker::new();
    let events = run(
        &mut tracker,
        &[
            Input::Arm { at: 10.0 },
            transport(false, 0.0, 10.5),
            transport(true, 4.0, 12.0),
            transport(true, 4.5, 12.5),
            transport(true, 5.0, 13.0),
            transport(false, 7.0, 15.0),
            transport(false, 7.0, 15.5),
            Input::Disarm { at: 16.0 },
        ],
    );
    assert_eq!(
        events,
        [
            Event::TakeOpened(take(0, 2.0, anchor(4.0), 0.0)),
            Event::TakeClosed(take(0, 2.0, anchor(4.0), 3.0)),
        ]
    );
    assert!(!tracker.is_armed());
}

#[test]
fn several_play_spans_in_one_arm() {
    let mut tracker = TakeTracker::new();
    let events = run(
        &mut tracker,
        &[
            Input::Arm { at: 0.0 },
            transport(true, 8.0, 1.0),
            transport(false, 10.0, 3.0),
            transport(true, 20.0, 5.0),
            transport(true, 21.0, 6.0),
            transport(false, 21.5, 6.5),
            Input::Disarm { at: 7.0 },
        ],
    );
    assert_eq!(
        events,
        [
            Event::TakeOpened(take(0, 1.0, anchor(8.0), 0.0)),
            Event::TakeClosed(take(0, 1.0, anchor(8.0), 2.0)),
            Event::TakeOpened(take(1, 5.0, anchor(20.0), 0.0)),
            Event::TakeClosed(take(1, 5.0, anchor(20.0), 1.5)),
        ]
    );
}

#[test]
fn loop_wrap_starts_a_new_take() {
    let mut tracker = TakeTracker::new();
    let events = run(
        &mut tracker,
        &[
            Input::Arm { at: 0.0 },
            transport(true, 2.0, 1.0),
            transport(true, 3.0, 2.0),
            transport(true, 3.75, 2.75),
            // The loop end at 4.0 wraps back to the loop start at 2.0.
            transport(true, 2.0, 3.0),
            transport(true, 3.0, 4.0),
            transport(false, 3.5, 4.5),
        ],
    );
    assert_eq!(
        events,
        [
            Event::TakeOpened(take(0, 1.0, anchor(2.0), 0.0)),
            Event::TakeClosed(take(0, 1.0, anchor(2.0), 2.0)),
            Event::TakeOpened(take(1, 3.0, anchor(2.0), 0.0)),
            Event::TakeClosed(take(1, 3.0, anchor(2.0), 1.5)),
        ]
    );
}

#[test]
fn locate_while_playing_starts_a_new_take() {
    let mut tracker = TakeTracker::new();
    let events = run(
        &mut tracker,
        &[
            Input::Arm { at: 0.0 },
            transport(true, 10.0, 1.0),
            transport(true, 11.0, 2.0),
            // Locate forward, then back, while playing.
            transport(true, 40.0, 2.5),
            transport(true, 41.0, 3.5),
            transport(true, 5.0, 4.0),
            Input::Disarm { at: 5.0 },
        ],
    );
    assert_eq!(
        events,
        [
            Event::TakeOpened(take(0, 1.0, anchor(10.0), 0.0)),
            Event::TakeClosed(take(0, 1.0, anchor(10.0), 1.5)),
            Event::TakeOpened(take(1, 2.5, anchor(40.0), 0.0)),
            Event::TakeClosed(take(1, 2.5, anchor(40.0), 1.5)),
            Event::TakeOpened(take(2, 4.0, anchor(5.0), 0.0)),
            Event::TakeClosed(take(2, 4.0, anchor(5.0), 1.0)),
        ]
    );
}

#[test]
fn small_timing_jitter_keeps_one_take() {
    let mut tracker = TakeTracker::new();
    let events = run(
        &mut tracker,
        &[
            Input::Arm { at: 0.0 },
            transport(true, 0.0, 1.0),
            transport(true, 0.51, 1.5),
            transport(true, 0.99, 2.0),
            transport(false, 1.5, 2.5),
        ],
    );
    assert_eq!(
        events,
        [
            Event::TakeOpened(take(0, 1.0, anchor(0.0), 0.0)),
            Event::TakeClosed(take(0, 1.0, anchor(0.0), 1.5)),
        ]
    );
}

#[test]
fn arm_without_play_records_an_unanchored_entry() {
    let mut tracker = TakeTracker::new();
    let events = run(
        &mut tracker,
        &[
            Input::Arm { at: 10.0 },
            transport(false, 3.0, 11.0),
            Input::Disarm { at: 13.0 },
        ],
    );
    assert_eq!(
        events,
        [
            Event::TakeOpened(take(0, 0.0, None, 0.0)),
            Event::TakeClosed(take(0, 0.0, None, 3.0)),
        ]
    );
}

#[test]
fn play_before_arm_starts_the_take_at_arm() {
    let mut tracker = TakeTracker::new();
    let events = run(
        &mut tracker,
        &[
            transport(true, 1.0, 9.0),
            Input::Arm { at: 9.5 },
            transport(true, 2.0, 10.0),
            transport(false, 3.0, 11.0),
            Input::Disarm { at: 12.0 },
        ],
    );
    // The transport position is read at arm time: 1.0 s + 0.5 s elapsed.
    assert_eq!(
        events,
        [
            Event::TakeOpened(take(0, 0.0, anchor(1.5), 0.0)),
            Event::TakeClosed(take(0, 0.0, anchor(1.5), 1.5)),
        ]
    );
}

#[test]
fn disarm_while_playing_closes_the_take() {
    let mut tracker = TakeTracker::new();
    let events = run(
        &mut tracker,
        &[
            Input::Arm { at: 0.0 },
            transport(true, 0.0, 1.0),
            Input::Disarm { at: 4.0 },
            transport(true, 3.5, 4.5),
            transport(false, 4.0, 5.0),
        ],
    );
    assert_eq!(
        events,
        [
            Event::TakeOpened(take(0, 1.0, anchor(0.0), 0.0)),
            Event::TakeClosed(take(0, 1.0, anchor(0.0), 3.0)),
        ]
    );
    assert!(tracker.open_take().is_none());
}

#[test]
fn frame_clock_maps_host_time_to_file_time() {
    let mut tracker = TakeTracker::new();
    let events = run(
        &mut tracker,
        &[
            Input::Arm { at: 10.0 },
            // The first frame lands in the file 0.25 s after arm.
            Input::FrameClock {
                host_time: 10.25,
                file_sec: 0.0,
            },
            transport(true, 0.0, 12.0),
            transport(false, 2.0, 14.0),
        ],
    );
    assert_eq!(
        events,
        [
            Event::TakeOpened(take(0, 1.75, anchor(0.0), 0.0)),
            Event::TakeClosed(take(0, 1.75, anchor(0.0), 2.0)),
        ]
    );
}

#[test]
fn ignores_repeated_arm_and_disarm() {
    let mut tracker = TakeTracker::new();
    assert!(tracker.handle(Input::Disarm { at: 0.0 }).is_empty());
    assert!(tracker.handle(Input::Arm { at: 1.0 }).is_empty());
    assert!(tracker.handle(Input::Arm { at: 2.0 }).is_empty());
    assert_eq!(
        tracker.handle(Input::Disarm { at: 3.0 }),
        [
            Event::TakeOpened(take(0, 0.0, None, 0.0)),
            Event::TakeClosed(take(0, 0.0, None, 2.0)),
        ]
    );
}
