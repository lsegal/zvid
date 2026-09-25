//! Hooks the plugin-format layers call from the audio thread.

/// Receives the plugin's input audio for recording (AAC in the capture file).
///
/// Called on the audio thread once per render block, after the input has been
/// passed through, so implementations must not block or allocate.
pub trait InputTap: Send + Sync {
    /// `channels` holds one non-interleaved `f32` slice per input channel,
    /// all the same length. `host_time` is the host clock time, in seconds, of
    /// the block's first frame, when the host reports one.
    fn process(&self, channels: &[&[f32]], sample_rate: f64, host_time: Option<f64>);
}
