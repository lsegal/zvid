//! Container bridge for platform-encoded HEVC/AV1 and AAC tracks.
//! Final sample tables, payloads and gapless metadata are written by zvidlib.
use zvidlib::{
    AudioGapless, EncodedSample, EncoderConfig, Error, ErrorKind,
    Mp4Demuxer, Mp4DemuxerOptions, Result, TrackKind,
};
use zvidlib::io::{MemorySink, MemorySource};
use zvidlib::mp4::{Mp4Muxer, Mp4TrackConfig, Mp4TrackFormat};

fn invalid(message: &str) -> Error {
    Error::new(ErrorKind::InvalidInput, message)
}

pub async fn mux(video: Vec<u8>, audio: Option<Vec<u8>>) -> Result<Vec<u8>> {
    let sources = if let Some(audio) = audio {
        vec![MemorySource::new(video), MemorySource::new(audio)]
    } else {
        vec![MemorySource::new(video)]
    };
    let mut tracks = Vec::new();
    let mut configs = Vec::new();
    for (source_index, source) in sources.iter().enumerate() {
        let movie = Mp4Demuxer::open(source, Mp4DemuxerOptions::default()).await?;
        for track in movie.tracks {
            if sources.len() == 2
                && ((source_index == 0 && track.kind != TrackKind::Video)
                    || (source_index == 1 && track.kind != TrackKind::Audio))
            {
                continue;
            }
            let format = match track.kind {
                TrackKind::Video => Mp4TrackFormat::Video(
                    track.dimensions.ok_or_else(|| invalid("missing video dimensions"))?,
                ),
                TrackKind::Audio => Mp4TrackFormat::Audio {
                    channels: track.channels.ok_or_else(|| invalid("missing audio channels"))?,
                },
            };
            configs.push(Mp4TrackConfig {
                encoder: EncoderConfig {
                    codec: track.codec,
                    timescale: track.timescale,
                    decoder_config: track.decoder_config.clone(),
                },
                format,
            });
            tracks.push((source_index, movie.movie_timescale, track));
        }
    }
    if tracks.iter().filter(|(_, _, t)| t.kind == TrackKind::Video).count() != 1
        || tracks.iter().filter(|(_, _, t)| t.kind == TrackKind::Audio).count() > 1
        || (sources.len() == 2 && tracks.len() != 2)
    {
        return Err(invalid("export requires one video track and at most one audio track"));
    }
    let mut output = Mp4Muxer::new(MemorySink::new(), configs, 10_000_000).await?;
    for (output_index, (source_index, movie_timescale, track)) in tracks.iter().enumerate() {
        if track.kind == TrackKind::Audio {
            // The muxer's gapless values use the track clock. Reject clocks we
            // cannot preserve rather than introducing a silent A/V offset.
            if track.sample_rate != Some(track.timescale) {
                return Err(invalid("AAC sample and track clocks must match"));
            }
            let timing = track.audio_timing(*movie_timescale)?;
            if timing.track_offset != 0 {
                return Err(invalid("delayed audio tracks are not supported for export"));
            }
            output.set_audio_gapless(output_index, AudioGapless {
                priming: timing.priming,
                padding: timing.padding,
            })?;
        } else if track.edits.iter().any(|edit| edit.media_time != 0) {
            return Err(invalid("video encoder must produce a zero-origin timeline"));
        }
        for (sample_index, sample) in track.samples.iter().enumerate() {
            let mut data = vec![0; sample.size as usize];
            track.read_sample_into(&sources[*source_index], sample_index, &mut data).await?;
            output.write_sample(output_index, EncodedSample {
                data,
                dts: i64::try_from(sample.dts).map_err(|_| invalid("decode timestamp overflow"))?,
                pts: sample.pts,
                duration: sample.duration,
                is_sync: sample.is_sync,
                dependency: sample.dependency,
            }).await?;
        }
    }
    Ok(output.finish().await?.into_inner())
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen(js_name = muxMp4)]
pub async fn mux_mp4(video: Vec<u8>) -> std::result::Result<Vec<u8>, wasm_bindgen::JsValue> {
    mux(video, None).await.map_err(|error| wasm_bindgen::JsValue::from_str(&error.to_string()))
}

#[cfg(test)]
mod tests {
    #[test]
    fn rejects_invalid_container() {
        assert!(futures::executor::block_on(super::mux(vec![0; 16], None)).is_err());
    }
}
