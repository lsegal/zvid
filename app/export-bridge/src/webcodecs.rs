//! The browser side of the export: what this device can encode, and the
//! `WebCodecs` video and AAC encoders the export drives. web-sys gates its
//! `WebCodecs` bindings behind an unstable cfg, so the few calls used here
//! are bound directly.
use crate::codec::{self, VideoCodec};
use crate::{EncodedTrack, mux_mp4, mux_webm};
use js_sys::{Float32Array, Function, Object, Promise, Reflect, Uint8Array};
use std::cell::{Cell, RefCell};
use std::rc::Rc;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::{JsFuture, future_to_promise};
use zvidlib::mp4::{Mp4TrackConfig, Mp4TrackFormat};
use zvidlib::{
    AudioGapless, Codec, EncodedSample, EncoderConfig, SampleDependency, VideoDimensions,
};

type JsResult<T> = std::result::Result<T, JsValue>;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_name = VideoEncoder)]
    #[derive(Clone)]
    type JsVideoEncoder;
    #[wasm_bindgen(constructor, js_class = "VideoEncoder", catch)]
    fn new(init: &Object) -> JsResult<JsVideoEncoder>;
    #[wasm_bindgen(static_method_of = JsVideoEncoder, js_class = "VideoEncoder", js_name = isConfigSupported, catch)]
    fn is_config_supported(config: &Object) -> JsResult<Promise>;
    #[wasm_bindgen(method, catch)]
    fn configure(this: &JsVideoEncoder, config: &Object) -> JsResult<()>;
    #[wasm_bindgen(method, catch)]
    fn encode(this: &JsVideoEncoder, frame: &JsVideoFrame, options: &Object) -> JsResult<()>;
    #[wasm_bindgen(method)]
    fn flush(this: &JsVideoEncoder) -> Promise;
    #[wasm_bindgen(method, catch)]
    fn close(this: &JsVideoEncoder) -> JsResult<()>;
    #[wasm_bindgen(method, getter, js_name = encodeQueueSize)]
    fn encode_queue_size(this: &JsVideoEncoder) -> u32;
    #[wasm_bindgen(method, setter)]
    fn set_ondequeue(this: &JsVideoEncoder, handler: &JsValue);

    #[wasm_bindgen(js_name = VideoFrame)]
    type JsVideoFrame;
    #[wasm_bindgen(constructor, js_class = "VideoFrame", catch)]
    fn new(source: &JsValue, init: &Object) -> JsResult<JsVideoFrame>;
    #[wasm_bindgen(method)]
    fn close(this: &JsVideoFrame);

    #[wasm_bindgen(js_name = AudioEncoder)]
    type JsAudioEncoder;
    #[wasm_bindgen(constructor, js_class = "AudioEncoder", catch)]
    fn new(init: &Object) -> JsResult<JsAudioEncoder>;
    #[wasm_bindgen(static_method_of = JsAudioEncoder, js_class = "AudioEncoder", js_name = isConfigSupported, catch)]
    fn is_config_supported(config: &Object) -> JsResult<Promise>;
    #[wasm_bindgen(method, catch)]
    fn configure(this: &JsAudioEncoder, config: &Object) -> JsResult<()>;
    #[wasm_bindgen(method, catch)]
    fn encode(this: &JsAudioEncoder, data: &JsAudioData) -> JsResult<()>;
    #[wasm_bindgen(method)]
    fn flush(this: &JsAudioEncoder) -> Promise;
    #[wasm_bindgen(method, catch)]
    fn close(this: &JsAudioEncoder) -> JsResult<()>;

    #[wasm_bindgen(js_name = AudioData)]
    type JsAudioData;
    #[wasm_bindgen(constructor, js_class = "AudioData", catch)]
    fn new(init: &Object) -> JsResult<JsAudioData>;
    #[wasm_bindgen(method)]
    fn close(this: &JsAudioData);

    /// An `EncodedVideoChunk` or `EncodedAudioChunk`.
    type EncodedChunk;
    #[wasm_bindgen(method, getter, js_name = byteLength)]
    fn byte_length(this: &EncodedChunk) -> u32;
    #[wasm_bindgen(method, js_name = copyTo)]
    fn copy_to(this: &EncodedChunk, destination: &Uint8Array);
    #[wasm_bindgen(method, getter, js_name = type)]
    fn kind(this: &EncodedChunk) -> String;
    #[wasm_bindgen(method, getter)]
    fn timestamp(this: &EncodedChunk) -> f64;
    #[wasm_bindgen(method, getter)]
    fn duration(this: &EncodedChunk) -> Option<f64>;
}

fn js_error(message: impl AsRef<str>) -> JsValue {
    js_sys::Error::new(message.as_ref()).into()
}

fn object(entries: &[(&str, JsValue)]) -> Object {
    let object = Object::new();
    for (key, value) in entries {
        let _ = Reflect::set(&object, &JsValue::from_str(key), value);
    }
    object
}

fn get(target: &JsValue, key: &str) -> JsValue {
    Reflect::get(target, &JsValue::from_str(key)).unwrap_or(JsValue::UNDEFINED)
}

fn has_global(name: &str) -> bool {
    !get(&js_sys::global(), name).is_undefined()
}

/// The message of a `WebCodecs` error callback's `DOMException`.
fn error_message(error: &JsValue) -> String {
    get(error, "message")
        .as_string()
        .unwrap_or_else(|| "the encoder reported an error".to_owned())
}

/// Firefox's `isConfigSupported()` is unreliable, so a probe there also has
/// to try encoding a frame.
fn is_firefox() -> bool {
    get(&get(&js_sys::global(), "navigator"), "userAgent")
        .as_string()
        .is_some_and(|agent| agent.contains("Firefox"))
}

/// A chunk's bytes, its key flag and its timestamp in microseconds.
struct Chunk {
    data: Vec<u8>,
    key: bool,
    timestamp: f64,
    duration: Option<f64>,
}

impl Chunk {
    fn read(chunk: &EncodedChunk) -> Self {
        let data = Uint8Array::new_with_length(chunk.byte_length());
        chunk.copy_to(&data);
        Self {
            data: data.to_vec(),
            key: chunk.kind() == "key",
            timestamp: chunk.timestamp(),
            duration: chunk.duration(),
        }
    }
}

/// The `decoderConfig.description` an encoder's output metadata carries.
fn description(metadata: &JsValue) -> Option<Vec<u8>> {
    let description = get(&get(metadata, "decoderConfig"), "description");
    (!description.is_undefined() && !description.is_null())
        .then(|| Uint8Array::new(&description).to_vec())
        .filter(|bytes| !bytes.is_empty())
}

/// What an encoder's callbacks have delivered so far.
#[derive(Default)]
struct Output {
    chunks: Vec<Chunk>,
    description: Option<Vec<u8>>,
    error: Option<String>,
    /// Resolves the frame waiting for the encoder's queue to drain.
    on_dequeue: Option<Function>,
}

impl Output {
    fn wake(&mut self) {
        if let Some(resolve) = self.on_dequeue.take() {
            let _ = resolve.call0(&JsValue::NULL);
        }
    }

    fn check(&mut self) -> JsResult<()> {
        self.error
            .take()
            .map_or(Ok(()), |message| Err(js_error(message)))
    }
}

type OutputCallback = Closure<dyn FnMut(EncodedChunk, JsValue)>;
type ErrorCallback = Closure<dyn FnMut(JsValue)>;

/// The output and error callbacks of an encoder writing to `output`.
fn callbacks(output: &Rc<RefCell<Output>>) -> (OutputCallback, ErrorCallback) {
    let chunks = Rc::clone(output);
    let on_output = Closure::new(move |chunk: EncodedChunk, metadata: JsValue| {
        let mut output = chunks.borrow_mut();
        if output.description.is_none() {
            output.description = description(&metadata);
        }
        output.chunks.push(Chunk::read(&chunk));
    });
    let errors = Rc::clone(output);
    let on_error = Closure::new(move |error: JsValue| {
        let mut output = errors.borrow_mut();
        output.error = Some(error_message(&error));
        output.wake();
    });
    (on_output, on_error)
}

/// The encoder configuration for `codec` at `width`×`height` and `bitrate`
/// bits a second: variable bitrate in realtime mode, alpha discarded, H.264
/// and HEVC with out-of-band parameter sets.
fn video_config(codec: VideoCodec, width: u32, height: u32, bitrate: u32) -> Object {
    let config = object(&[
        ("codec", codec.codec_string(width, height, bitrate).into()),
        ("width", width.into()),
        ("height", height.into()),
        ("bitrate", bitrate.into()),
        ("bitrateMode", "variable".into()),
        ("alpha", "discard".into()),
        ("latencyMode", "realtime".into()),
    ]);
    let extension = match codec {
        VideoCodec::H264 => Some(("avc", "avc")),
        VideoCodec::Hevc => Some(("hevc", "hevc")),
        _ => None,
    };
    if let Some((key, format)) = extension {
        let _ = Reflect::set(&config, &key.into(), &object(&[("format", format.into())]));
    }
    config
}

async fn video_config_supported(config: &Object) -> bool {
    let Ok(promise) = JsVideoEncoder::is_config_supported(config) else {
        return false;
    };
    JsFuture::from(promise)
        .await
        .is_ok_and(|support| get(&support, "supported").is_truthy())
}

/// Whether encoding one blank frame with `config` succeeds.
async fn trial_encode(config: &Object, width: u32, height: u32) -> bool {
    let failed = Rc::new(Cell::new(false));
    let on_error = {
        let failed = Rc::clone(&failed);
        Closure::<dyn FnMut(JsValue)>::new(move |_| failed.set(true))
    };
    let on_output = Closure::<dyn FnMut(JsValue)>::new(|_| {});
    let init = object(&[
        ("output", on_output.as_ref().clone()),
        ("error", on_error.as_ref().clone()),
    ]);
    let Ok(encoder) = JsVideoEncoder::new(&init) else {
        return false;
    };
    let attempt = async {
        encoder.configure(config).ok()?;
        let pixels = Uint8Array::new_with_length(width * height * 4);
        let frame = JsVideoFrame::new(
            &pixels,
            &object(&[
                ("format", "RGBA".into()),
                ("codedWidth", width.into()),
                ("codedHeight", height.into()),
                ("timestamp", 0.into()),
            ]),
        )
        .ok()?;
        let encoded = encoder.encode(&frame, &Object::new());
        frame.close();
        encoded.ok()?;
        JsFuture::from(encoder.flush()).await.ok()
    };
    let succeeded = attempt.await.is_some() && !failed.get();
    let _ = encoder.close();
    succeeded
}

/// Whether this device can encode `codec` (`"h264"`, `"hevc"`, `"av1"`,
/// `"vp8"` or `"vp9"`) at `width`×`height` and `bitrate` bits a second.
#[wasm_bindgen(js_name = canEncodeVideo)]
pub async fn can_encode_video(codec: String, width: u32, height: u32, bitrate: u32) -> bool {
    let Some(codec) = VideoCodec::from_name(&codec) else {
        return false;
    };
    if width == 0 || height == 0 || bitrate == 0 || !has_global("VideoEncoder") {
        return false;
    }
    if codec.needs_even_dimensions() && (width % 2 == 1 || height % 2 == 1) {
        return false;
    }
    let config = video_config(codec, width, height, bitrate);
    video_config_supported(&config).await
        && (!is_firefox() || trial_encode(&config, width, height).await)
}

fn aac_config(sample_rate: u32, channels: u16, bitrate: u32) -> Object {
    object(&[
        ("codec", "mp4a.40.2".into()),
        ("sampleRate", sample_rate.into()),
        ("numberOfChannels", channels.into()),
        ("bitrate", bitrate.into()),
        ("aac", object(&[("format", "aac".into())]).into()),
    ])
}

/// Whether this device can encode AAC-LC audio at `sample_rate` with
/// `channels` channels and `bitrate` bits a second, which an audible MP4
/// needs.
#[wasm_bindgen(js_name = canEncodeAac)]
pub async fn can_encode_aac(sample_rate: u32, channels: u16, bitrate: u32) -> bool {
    if !has_global("AudioEncoder") {
        return false;
    }
    let Ok(promise) =
        JsAudioEncoder::is_config_supported(&aac_config(sample_rate, channels, bitrate))
    else {
        return false;
    };
    JsFuture::from(promise)
        .await
        .is_ok_and(|support| get(&support, "supported").is_truthy())
}

/// AAC input handed to the encoder at a time, in frames.
const AAC_CHUNK_FRAMES: usize = 48_000;

/// Encodes interleaved `pcm` to AAC-LC with the browser's encoder, returning
/// the track and its gapless trim.
async fn encode_aac(
    pcm: &[f32],
    channels: u16,
    sample_rate: u32,
    bitrate: u32,
) -> JsResult<(EncodedTrack, AudioGapless)> {
    let channel_count = usize::from(channels);
    if channel_count == 0 || pcm.is_empty() || !pcm.len().is_multiple_of(channel_count) {
        return Err(js_error(
            "AAC input must be whole frames of interleaved PCM",
        ));
    }
    let output = Rc::new(RefCell::new(Output::default()));
    let (on_output, on_error) = callbacks(&output);
    let encoder = JsAudioEncoder::new(&object(&[
        ("output", on_output.as_ref().clone()),
        ("error", on_error.as_ref().clone()),
    ]))?;
    let encoded = async {
        encoder.configure(&aac_config(sample_rate, channels, bitrate))?;
        let mut position = 0_usize;
        for chunk in pcm.chunks(AAC_CHUNK_FRAMES * channel_count) {
            let frames = chunk.len() / channel_count;
            let data = JsAudioData::new(&object(&[
                ("format", "f32".into()),
                ("sampleRate", sample_rate.into()),
                ("numberOfFrames", (frames as u32).into()),
                ("numberOfChannels", channels.into()),
                (
                    "timestamp",
                    (position as f64 * 1e6 / f64::from(sample_rate))
                        .round()
                        .into(),
                ),
                ("data", Float32Array::from(chunk).into()),
            ]))?;
            let result = encoder.encode(&data);
            data.close();
            result?;
            position += frames;
            output.borrow_mut().check()?;
        }
        let flushed = JsFuture::from(encoder.flush()).await;
        output.borrow_mut().check()?;
        flushed.map(|_| ())
    }
    .await;
    let _ = encoder.close();
    encoded?;

    let output = output.take();
    let input_frames = (pcm.len() / channel_count) as u64;
    let to_frames = |micros: f64| (micros * f64::from(sample_rate) / 1e6).round();
    // An encoder that primes ahead of the input starts before zero.
    let priming = output
        .chunks
        .first()
        .map_or(0.0, |chunk| to_frames(-chunk.timestamp).max(0.0)) as u32;
    let mut pts = 0_i64;
    let samples: Vec<EncodedSample> = output
        .chunks
        .into_iter()
        .map(|chunk| {
            let duration = chunk
                .duration
                .map_or(1024, |micros| to_frames(micros) as u32)
                .max(1);
            let sample = EncodedSample {
                data: chunk.data,
                dts: pts,
                pts,
                duration,
                is_sync: true,
                dependency: SampleDependency::INDEPENDENT,
            };
            pts += i64::from(duration);
            sample
        })
        .collect();
    if samples.is_empty() {
        return Err(js_error("the AAC encoder returned no audio"));
    }
    let padding = (pts as u64).saturating_sub(u64::from(priming) + input_frames) as u32;
    let audio_specific_config = output
        .description
        .and_then(|description| codec::audio_specific_config(&description))
        .unwrap_or_else(|| codec::aac_lc_audio_specific_config(sample_rate, channels));
    let config = Mp4TrackConfig {
        encoder: EncoderConfig {
            codec: Codec::Aac,
            timescale: sample_rate,
            decoder_config: codec::esds_box(&audio_specific_config),
        },
        format: Mp4TrackFormat::Audio { channels },
    };
    Ok((
        EncodedTrack { config, samples },
        AudioGapless { priming, padding },
    ))
}

/// Encodes the export's canvas frames as they render, then writes the final
/// file. Create one with `createExportEncoder`, add each frame with
/// `addFrame`, and end with `finish` (or `close` to cancel).
#[wasm_bindgen]
pub struct ExportEncoder {
    encoder: JsVideoEncoder,
    codec: VideoCodec,
    dimensions: VideoDimensions,
    vp9_level: u8,
    timescale: u32,
    frame_duration: u32,
    frames: Cell<u64>,
    closed: Rc<Cell<bool>>,
    output: Rc<RefCell<Output>>,
    _on_output: OutputCallback,
    _on_error: ErrorCallback,
    _on_dequeue: Closure<dyn FnMut()>,
}

/// Opens an encoder for `codec` at `width`×`height`, `bitrate` bits a second
/// and `frame_rate` frames a second, with a key frame every two seconds.
#[wasm_bindgen(js_name = createExportEncoder)]
pub async fn create_export_encoder(
    codec: String,
    width: u32,
    height: u32,
    bitrate: u32,
    frame_rate: f64,
) -> JsResult<ExportEncoder> {
    let video_codec = VideoCodec::from_name(&codec)
        .ok_or_else(|| js_error(format!("unknown video codec: {codec}")))?;
    let dimensions =
        codec::dimensions(width, height).map_err(|error| js_error(error.to_string()))?;
    let (timescale, frame_duration) =
        codec::frame_clock(frame_rate).map_err(|error| js_error(error.to_string()))?;
    let config = video_config(video_codec, width, height, bitrate);
    let _ = Reflect::set(&config, &"framerate".into(), &frame_rate.into());
    if !video_config_supported(&config).await {
        return Err(js_error(format!(
            "this device cannot encode {codec} at {width}×{height}"
        )));
    }
    let output = Rc::new(RefCell::new(Output::default()));
    let (on_output, on_error) = callbacks(&output);
    let encoder = JsVideoEncoder::new(&object(&[
        ("output", on_output.as_ref().clone()),
        ("error", on_error.as_ref().clone()),
    ]))?;
    let dequeued = Rc::clone(&output);
    let on_dequeue = Closure::<dyn FnMut()>::new(move || dequeued.borrow_mut().wake());
    encoder.set_ondequeue(on_dequeue.as_ref());
    encoder.configure(&config)?;
    Ok(ExportEncoder {
        encoder,
        codec: video_codec,
        dimensions,
        vp9_level: codec::vp9_level(width, height, bitrate),
        timescale,
        frame_duration,
        frames: Cell::new(0),
        closed: Rc::new(Cell::new(false)),
        output,
        _on_output: on_output,
        _on_error: on_error,
        _on_dequeue: on_dequeue,
    })
}

#[wasm_bindgen]
impl ExportEncoder {
    /// Microseconds from the start to `frame`.
    fn micros(&self, frame: u64) -> f64 {
        (frame as f64 * f64::from(self.frame_duration) * 1e6 / f64::from(self.timescale)).round()
    }

    /// Whether `frame` starts a new two-second span, which opens on a key
    /// frame.
    fn starts_key_span(&self, frame: u64) -> bool {
        let span =
            |frame: u64| frame * u64::from(self.frame_duration) / (2 * u64::from(self.timescale));
        frame == 0 || span(frame) != span(frame - 1)
    }

    /// Encodes the canvas (an `HTMLCanvasElement` or `OffscreenCanvas`) as
    /// the next frame, resolving once the encoder can take another.
    #[wasm_bindgen(js_name = addFrame)]
    pub fn add_frame(&self, canvas: JsValue) -> Promise {
        let submitted = (|| {
            if self.closed.get() {
                return Err(js_error("the export encoder is closed"));
            }
            self.output.borrow_mut().check()?;
            let index = self.frames.get();
            let frame = JsVideoFrame::new(
                &canvas,
                &object(&[
                    ("timestamp", self.micros(index).into()),
                    (
                        "duration",
                        (self.micros(index + 1) - self.micros(index)).into(),
                    ),
                ]),
            )?;
            let encoded = self.encoder.encode(
                &frame,
                &object(&[("keyFrame", self.starts_key_span(index).into())]),
            );
            frame.close();
            encoded?;
            self.frames.set(index + 1);
            Ok(())
        })();
        let encoder = self.encoder.clone();
        let output = Rc::clone(&self.output);
        future_to_promise(async move {
            submitted?;
            if encoder.encode_queue_size() >= 4 {
                let drained =
                    Promise::new(&mut |resolve, _| output.borrow_mut().on_dequeue = Some(resolve));
                JsFuture::from(drained).await?;
            }
            output.borrow_mut().check()?;
            Ok(JsValue::UNDEFINED)
        })
    }

    /// Finishes encoding and resolves with the final file's bytes. `pcm` is
    /// the export's interleaved audio of `channels` channels at
    /// `sample_rate`, encoded at `audio_bitrate` bits a second: AAC in an
    /// MP4, Opus in a WebM. `cover` is the MP4's JPEG thumbnail.
    pub fn finish(
        &self,
        pcm: Option<Vec<f32>>,
        channels: u16,
        sample_rate: u32,
        audio_bitrate: u32,
        cover: Option<Vec<u8>>,
    ) -> Promise {
        let encoder = self.encoder.clone();
        let output = Rc::clone(&self.output);
        let closed = Rc::clone(&self.closed);
        let codec = self.codec;
        let dimensions = self.dimensions;
        let vp9_level = self.vp9_level;
        let timescale = self.timescale;
        let frame_duration = self.frame_duration;
        future_to_promise(async move {
            if closed.replace(true) {
                return Err(js_error("the export encoder is closed"));
            }
            let flushed = JsFuture::from(encoder.flush()).await;
            output.borrow_mut().check()?;
            flushed?;
            let _ = encoder.close();
            let Output {
                chunks,
                description,
                ..
            } = output.take();
            let video = video_track(
                codec,
                dimensions,
                vp9_level,
                timescale,
                frame_duration,
                chunks,
                description,
            )?;
            let bytes = if codec.is_webm() {
                mux_webm(video, pcm, channels, audio_bitrate).await
            } else {
                let audio = match pcm {
                    Some(pcm) => {
                        Some(encode_aac(&pcm, channels, sample_rate, audio_bitrate).await?)
                    }
                    None => None,
                };
                mux_mp4(video, audio, cover).await
            }
            .map_err(|error| js_error(error.to_string()))?;
            Ok(Uint8Array::from(bytes.as_slice()).into())
        })
    }

    /// Stops encoding without writing a file.
    pub fn close(&self) {
        if !self.closed.replace(true) {
            let _ = self.encoder.close();
        }
    }
}

impl Drop for ExportEncoder {
    fn drop(&mut self) {
        self.close();
        // A dequeue event already queued would otherwise call the dropped
        // closure.
        self.encoder.set_ondequeue(&JsValue::NULL);
    }
}

/// The encoded video track: the chunks on the frame clock, under the sample
/// entry their first key frame and `description` give.
fn video_track(
    codec: VideoCodec,
    dimensions: VideoDimensions,
    vp9_level: u8,
    timescale: u32,
    frame_duration: u32,
    chunks: Vec<Chunk>,
    description: Option<Vec<u8>>,
) -> JsResult<EncodedTrack> {
    let first = chunks
        .first()
        .ok_or_else(|| js_error("the video encoder returned no frames"))?;
    if !first.key {
        return Err(js_error("the video encoder did not start on a key frame"));
    }
    let decoder_config =
        codec::video_decoder_config(codec, &first.data, description.as_deref(), vp9_level)
            .map_err(|error| js_error(error.to_string()))?;
    let frames_per_micro = f64::from(timescale) / f64::from(frame_duration) / 1e6;
    let samples = chunks
        .into_iter()
        .map(|chunk| {
            let pts =
                (chunk.timestamp * frames_per_micro).round() as i64 * i64::from(frame_duration);
            EncodedSample {
                data: chunk.data,
                dts: pts,
                pts,
                duration: frame_duration,
                is_sync: chunk.key,
                dependency: if chunk.key {
                    SampleDependency::INDEPENDENT
                } else {
                    SampleDependency::DEPENDENT
                },
            }
        })
        .collect();
    Ok(EncodedTrack {
        config: Mp4TrackConfig {
            encoder: EncoderConfig {
                codec: codec.codec(),
                timescale,
                decoder_config,
            },
            format: Mp4TrackFormat::Video(dimensions),
        },
        samples,
    })
}
