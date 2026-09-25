//! Crash-safe MP4 writing.
//!
//! While recording, samples go to a fragmented MP4: the `moov` is written up
//! front, then one `moof` + `mdat` pair per fragment, each written with a
//! single `write` and synced. If the host dies mid-capture, the file holds
//! every complete fragment and plays as is. On disarm, [`finalize`] remuxes
//! it through zvidlib's [`Mp4Muxer`] into an ordinary MP4 (sample tables in
//! the `moov`, exact gapless audio metadata) and swaps it into place.

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use zvidlib::io::{ByteSink, IoFuture};
use zvidlib::mp4::{Mp4Muxer, Mp4TrackConfig, Mp4TrackFormat};
use zvidlib::{AudioGapless, Codec, EncodedSample, SampleDependency};

use super::bitstream::mp4_box;
use super::block_on;

const MOVIE_TIMESCALE: u32 = 1000;

/// A track of the fragmented file.
#[derive(Clone, Debug)]
pub struct Track {
    pub config: Mp4TrackConfig,
    /// Audio encoder delay to hide with an edit list, in track ticks.
    pub priming: u32,
}

/// Where a written sample lives, kept to remux the file on finalize.
#[derive(Clone, Copy, Debug)]
struct Indexed {
    offset: u64,
    size: u32,
    dts: i64,
    pts: i64,
    duration: u32,
    is_sync: bool,
    dependency: SampleDependency,
}

/// Writes a fragmented MP4 to a file.
pub struct FragmentedWriter {
    file: File,
    position: u64,
    tracks: Vec<Track>,
    queued: Vec<Vec<EncodedSample>>,
    index: Vec<Vec<Indexed>>,
    /// Decode time of each track's next sample.
    next_dts: Vec<i64>,
    sequence: u32,
}

impl FragmentedWriter {
    /// Writes the file header (`ftyp` and `moov`) and syncs it.
    pub fn create(mut file: File, tracks: Vec<Track>) -> io::Result<Self> {
        let mut header = ftyp();
        header.extend_from_slice(&moov(&tracks));
        file.write_all(&header)?;
        file.sync_data()?;
        let count = tracks.len();
        Ok(Self {
            file,
            position: header.len() as u64,
            tracks,
            queued: vec![Vec::new(); count],
            index: vec![Vec::new(); count],
            next_dts: vec![0; count],
            sequence: 0,
        })
    }

    pub fn tracks(&self) -> &[Track] {
        &self.tracks
    }

    /// Queues a sample for the next fragment. Samples of a track must have
    /// contiguous decode times starting at zero.
    pub fn push(&mut self, track: usize, sample: EncodedSample) -> io::Result<()> {
        let expected = self.next_dts[track];
        if sample.dts != expected || sample.duration == 0 || sample.data.is_empty() {
            return Err(invalid(
                "samples must be non-empty with contiguous timestamps",
            ));
        }
        self.next_dts[track] += i64::from(sample.duration);
        self.queued[track].push(sample);
        Ok(())
    }

    /// Duration queued for `track` and not yet written, in its ticks.
    pub fn queued_ticks(&self, track: usize) -> u64 {
        self.queued[track]
            .iter()
            .map(|sample| u64::from(sample.duration))
            .sum()
    }

    /// Writes every queued sample as one fragment and syncs the file.
    pub fn flush_fragment(&mut self) -> io::Result<()> {
        if self.queued.iter().all(Vec::is_empty) {
            return Ok(());
        }
        self.sequence += 1;
        let queued: Vec<Vec<EncodedSample>> = self.queued.iter_mut().map(std::mem::take).collect();
        let payload: usize = queued.iter().flatten().map(|s| s.data.len()).sum();

        // The moof's size doesn't depend on the data offsets it holds, so
        // build it once to measure it, then again with real offsets.
        let moof_len = self.moof(&queued, 0).len() as u64;
        let mdat_header = 8u64;
        let moof = self.moof(&queued, moof_len + mdat_header);
        debug_assert_eq!(moof.len() as u64, moof_len);

        let mut fragment = Vec::with_capacity(moof.len() + 8 + payload);
        fragment.extend_from_slice(&moof);
        fragment.extend_from_slice(&((payload as u64 + mdat_header) as u32).to_be_bytes());
        fragment.extend_from_slice(b"mdat");
        let mut offset = self.position + moof_len + mdat_header;
        for (track, samples) in queued.iter().enumerate() {
            for sample in samples {
                self.index[track].push(Indexed {
                    offset,
                    size: sample.data.len() as u32,
                    dts: sample.dts,
                    pts: sample.pts,
                    duration: sample.duration,
                    is_sync: sample.is_sync,
                    dependency: sample.dependency,
                });
                offset += sample.data.len() as u64;
                fragment.extend_from_slice(&sample.data);
            }
        }
        // One write per fragment, so a crash leaves whole fragments.
        self.file.write_all(&fragment)?;
        self.file.sync_data()?;
        self.position += fragment.len() as u64;
        Ok(())
    }

    fn moof(&self, queued: &[Vec<EncodedSample>], data_offset: u64) -> Vec<u8> {
        let mut body = full_box(b"mfhd", 0, 0, &self.sequence.to_be_bytes());
        let mut offset = data_offset;
        for (track, samples) in queued.iter().enumerate() {
            if samples.is_empty() {
                continue;
            }
            body.extend_from_slice(&traf(track as u32 + 1, samples, offset));
            offset += samples.iter().map(|s| s.data.len() as u64).sum::<u64>();
        }
        mp4_box(b"moof", &body)
    }

    /// Writes the last fragment and returns the index needed by
    /// [`finalize`].
    pub fn finish(mut self) -> io::Result<Written> {
        self.flush_fragment()?;
        Ok(Written {
            tracks: self.tracks,
            index: self.index,
        })
    }
}

/// A fragmented file's tracks and sample locations.
pub struct Written {
    tracks: Vec<Track>,
    index: Vec<Vec<Indexed>>,
}

impl Written {
    /// Samples written to `track`.
    #[cfg(test)]
    pub fn sample_count(&self, track: usize) -> usize {
        self.index[track].len()
    }
}

/// Remuxes the fragmented file at `path` into an ordinary MP4 with
/// zvidlib's muxer, then replaces `path` with it. `gapless` gives the audio
/// track's final encoder delay and padding. Until the rename, `path` still
/// holds the playable fragmented file.
pub fn finalize(
    path: &Path,
    written: &Written,
    gapless: &[(usize, AudioGapless)],
) -> io::Result<()> {
    let temp = finalizing_path(path);
    let result = remux(path, &temp, written, gapless);
    if let Err(error) = result {
        let _ = std::fs::remove_file(&temp);
        return Err(error);
    }
    std::fs::rename(&temp, path)
}

/// The temporary file [`finalize`] writes next to `path`.
pub fn finalizing_path(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".finalizing");
    path.with_file_name(name)
}

fn remux(
    source: &Path,
    target: &Path,
    written: &Written,
    gapless: &[(usize, AudioGapless)],
) -> io::Result<()> {
    let mut input = File::open(source)?;
    let sink = FileSink::new(File::create(target)?);
    let configs = written.tracks.iter().map(|t| t.config.clone()).collect();
    let most = written.index.iter().map(Vec::len).max().unwrap_or(0).max(1);
    let mut muxer = block_on(Mp4Muxer::new(sink, configs, most)).map_err(zvid_error)?;
    for &(track, value) in gapless {
        muxer.set_audio_gapless(track, value).map_err(zvid_error)?;
    }
    for (track, samples) in written.index.iter().enumerate() {
        for sample in samples {
            let mut data = vec![0; sample.size as usize];
            input.seek(SeekFrom::Start(sample.offset))?;
            input.read_exact(&mut data)?;
            block_on(muxer.write_sample(
                track,
                EncodedSample {
                    data,
                    dts: sample.dts,
                    pts: sample.pts,
                    duration: sample.duration,
                    is_sync: sample.is_sync,
                    dependency: sample.dependency,
                },
            ))
            .map_err(zvid_error)?;
        }
    }
    let sink = block_on(muxer.finish()).map_err(zvid_error)?;
    sink.file.sync_all()
}

/// A zvidlib [`ByteSink`] over a file.
pub struct FileSink {
    file: File,
    position: u64,
}

impl FileSink {
    pub fn new(file: File) -> Self {
        Self { file, position: 0 }
    }
}

impl ByteSink for FileSink {
    fn position(&self) -> u64 {
        self.position
    }

    fn write<'a>(&'a mut self, bytes: &'a [u8]) -> IoFuture<'a, ()> {
        let result = self.file.write_all(bytes).map_err(io_error);
        if result.is_ok() {
            self.position += bytes.len() as u64;
        }
        Box::pin(std::future::ready(result))
    }

    fn seek<'a>(&'a mut self, position: u64) -> IoFuture<'a, ()> {
        let result = self.file.seek(SeekFrom::Start(position)).map_err(io_error);
        if result.is_ok() {
            self.position = position;
        }
        Box::pin(std::future::ready(result.map(|_| ())))
    }

    fn flush<'a>(&'a mut self) -> IoFuture<'a, ()> {
        Box::pin(std::future::ready(self.file.flush().map_err(io_error)))
    }
}

fn io_error(error: io::Error) -> zvidlib::Error {
    zvidlib::Error::new(zvidlib::ErrorKind::Io, error.to_string())
}

fn zvid_error(error: zvidlib::Error) -> io::Error {
    io::Error::other(error.to_string())
}

fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message)
}

fn full_box(kind: &[u8; 4], version: u8, flags: u32, body: &[u8]) -> Vec<u8> {
    let mut payload = Vec::with_capacity(body.len() + 4);
    payload.push(version);
    payload.extend_from_slice(&flags.to_be_bytes()[1..]);
    payload.extend_from_slice(body);
    mp4_box(kind, &payload)
}

fn ftyp() -> Vec<u8> {
    let mut body = b"iso6".to_vec();
    body.extend_from_slice(&0u32.to_be_bytes());
    body.extend_from_slice(b"iso6isommp41");
    mp4_box(b"ftyp", &body)
}

fn moov(tracks: &[Track]) -> Vec<u8> {
    let mut mvhd = Vec::new();
    mvhd.extend_from_slice(&[0; 8]); // creation, modification
    mvhd.extend_from_slice(&MOVIE_TIMESCALE.to_be_bytes());
    mvhd.extend_from_slice(&0u32.to_be_bytes()); // duration: from fragments
    mvhd.extend_from_slice(&0x0001_0000u32.to_be_bytes());
    mvhd.extend_from_slice(&0x0100u16.to_be_bytes());
    mvhd.extend_from_slice(&[0; 10]);
    matrix(&mut mvhd);
    mvhd.extend_from_slice(&[0; 24]);
    mvhd.extend_from_slice(&(tracks.len() as u32 + 1).to_be_bytes());
    let mut body = full_box(b"mvhd", 0, 0, &mvhd);
    let mut mvex = Vec::new();
    for (index, track) in tracks.iter().enumerate() {
        let id = index as u32 + 1;
        body.extend_from_slice(&trak(id, track));
        let mut trex = id.to_be_bytes().to_vec();
        trex.extend_from_slice(&1u32.to_be_bytes()); // sample description index
        trex.extend_from_slice(&[0; 12]); // default duration, size, flags
        mvex.extend_from_slice(&full_box(b"trex", 0, 0, &trex));
    }
    body.extend_from_slice(&mp4_box(b"mvex", &mvex));
    mp4_box(b"moov", &body)
}

fn trak(id: u32, track: &Track) -> Vec<u8> {
    let (width, height, volume) = match track.config.format {
        Mp4TrackFormat::Video(dimensions) => (dimensions.width, dimensions.height, 0u16),
        Mp4TrackFormat::Audio { .. } => (0, 0, 0x0100),
    };
    let mut tkhd = vec![0; 8];
    tkhd.extend_from_slice(&id.to_be_bytes());
    tkhd.extend_from_slice(&[0; 4]);
    tkhd.extend_from_slice(&0u32.to_be_bytes()); // duration
    tkhd.extend_from_slice(&[0; 12]); // reserved, layer, alternate group
    tkhd.extend_from_slice(&volume.to_be_bytes());
    tkhd.extend_from_slice(&[0; 2]);
    matrix(&mut tkhd);
    tkhd.extend_from_slice(&(width << 16).to_be_bytes());
    tkhd.extend_from_slice(&(height << 16).to_be_bytes());
    let mut body = full_box(b"tkhd", 0, 7, &tkhd);
    if track.priming > 0 {
        // Duration 0: the edit covers the whole (fragmented) media.
        let mut elst = 1u32.to_be_bytes().to_vec();
        elst.extend_from_slice(&0u32.to_be_bytes());
        elst.extend_from_slice(&track.priming.to_be_bytes());
        elst.extend_from_slice(&0x0001_0000u32.to_be_bytes());
        body.extend_from_slice(&mp4_box(b"edts", &full_box(b"elst", 0, 0, &elst)));
    }

    let mut mdhd = vec![0; 8];
    mdhd.extend_from_slice(&track.config.encoder.timescale.to_be_bytes());
    mdhd.extend_from_slice(&0u32.to_be_bytes());
    mdhd.extend_from_slice(&0x55c4u16.to_be_bytes()); // "und"
    mdhd.extend_from_slice(&[0; 2]);
    let mut mdia = full_box(b"mdhd", 0, 0, &mdhd);
    let (handler, name, media_header) = match track.config.format {
        Mp4TrackFormat::Video(_) => (
            b"vide",
            &b"ZVID video\0"[..],
            full_box(b"vmhd", 0, 1, &[0; 8]),
        ),
        Mp4TrackFormat::Audio { .. } => (
            b"soun",
            &b"ZVID audio\0"[..],
            full_box(b"smhd", 0, 0, &[0; 4]),
        ),
    };
    let mut hdlr = vec![0; 4];
    hdlr.extend_from_slice(handler);
    hdlr.extend_from_slice(&[0; 12]);
    hdlr.extend_from_slice(name);
    mdia.extend_from_slice(&full_box(b"hdlr", 0, 0, &hdlr));

    let mut dref = 1u32.to_be_bytes().to_vec();
    dref.extend_from_slice(&full_box(b"url ", 0, 1, &[]));
    let mut minf = media_header;
    minf.extend_from_slice(&mp4_box(b"dinf", &full_box(b"dref", 0, 0, &dref)));
    let mut stsd = 1u32.to_be_bytes().to_vec();
    stsd.extend_from_slice(&sample_entry(&track.config));
    let mut stbl = full_box(b"stsd", 0, 0, &stsd);
    for kind in [b"stts", b"stsc", b"stco"] {
        stbl.extend_from_slice(&full_box(kind, 0, 0, &0u32.to_be_bytes()));
    }
    stbl.extend_from_slice(&full_box(b"stsz", 0, 0, &[0; 8]));
    minf.extend_from_slice(&mp4_box(b"stbl", &stbl));
    mdia.extend_from_slice(&mp4_box(b"minf", &minf));
    body.extend_from_slice(&mp4_box(b"mdia", &mdia));
    mp4_box(b"trak", &body)
}

fn sample_entry(config: &Mp4TrackConfig) -> Vec<u8> {
    let mut body = vec![0; 6];
    body.extend_from_slice(&1u16.to_be_bytes()); // data reference index
    match config.format {
        Mp4TrackFormat::Video(dimensions) => {
            body.extend_from_slice(&[0; 16]);
            body.extend_from_slice(&(dimensions.width as u16).to_be_bytes());
            body.extend_from_slice(&(dimensions.height as u16).to_be_bytes());
            body.extend_from_slice(&0x0048_0000u32.to_be_bytes());
            body.extend_from_slice(&0x0048_0000u32.to_be_bytes());
            body.extend_from_slice(&[0; 4]);
            body.extend_from_slice(&1u16.to_be_bytes()); // frame count
            body.extend_from_slice(&[0; 32]); // compressor name
            body.extend_from_slice(&0x0018u16.to_be_bytes());
            body.extend_from_slice(&0xffffu16.to_be_bytes());
            body.extend_from_slice(&config.encoder.decoder_config);
            let kind = if config.encoder.codec == Codec::Av1 {
                b"av01"
            } else {
                b"hvc1"
            };
            mp4_box(kind, &body)
        }
        Mp4TrackFormat::Audio { channels } => {
            body.extend_from_slice(&[0; 8]);
            body.extend_from_slice(&channels.to_be_bytes());
            body.extend_from_slice(&16u16.to_be_bytes());
            body.extend_from_slice(&[0; 4]);
            body.extend_from_slice(&(config.encoder.timescale << 16).to_be_bytes());
            body.extend_from_slice(&config.encoder.decoder_config);
            mp4_box(b"mp4a", &body)
        }
    }
}

fn traf(id: u32, samples: &[EncodedSample], data_offset: u64) -> Vec<u8> {
    // default-base-is-moof: data offsets count from the moof's first byte.
    let mut body = full_box(b"tfhd", 0, 0x02_0000, &id.to_be_bytes());
    body.extend_from_slice(&full_box(
        b"tfdt",
        1,
        0,
        &(samples[0].dts as u64).to_be_bytes(),
    ));
    let reorders = samples.iter().any(|sample| sample.pts != sample.dts);
    // data offset, and per-sample duration, size, flags (and composition
    // offset when samples are reordered).
    let flags = 0x0001 | 0x0100 | 0x0200 | 0x0400 | if reorders { 0x0800 } else { 0 };
    let mut trun = (samples.len() as u32).to_be_bytes().to_vec();
    trun.extend_from_slice(&(data_offset as u32).to_be_bytes());
    for sample in samples {
        trun.extend_from_slice(&sample.duration.to_be_bytes());
        trun.extend_from_slice(&(sample.data.len() as u32).to_be_bytes());
        trun.extend_from_slice(&sample_flags(sample).to_be_bytes());
        if reorders {
            trun.extend_from_slice(&((sample.pts - sample.dts) as i32).to_be_bytes());
        }
    }
    body.extend_from_slice(&full_box(b"trun", 1, flags, &trun));
    mp4_box(b"traf", &body)
}

fn sample_flags(sample: &EncodedSample) -> u32 {
    let dependency = sample.dependency;
    let non_sync = u32::from(!sample.is_sync) << 16;
    (u32::from(dependency.is_leading & 3) << 26)
        | (u32::from(dependency.depends_on & 3) << 24)
        | (u32::from(dependency.is_depended_on & 3) << 22)
        | (u32::from(dependency.has_redundancy & 3) << 20)
        | non_sync
}

fn matrix(out: &mut Vec<u8>) {
    for value in [0x0001_0000u32, 0, 0, 0, 0x0001_0000, 0, 0, 0, 0x4000_0000] {
        out.extend_from_slice(&value.to_be_bytes());
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use zvidlib::io::MemorySource;
    use zvidlib::{
        EncoderConfig, Limits, Mp4Demuxer, Mp4DemuxerOptions, TrackKind, VideoDimensions,
    };

    use crate::record::bitstream::{aac_lc_config, esds_box};

    fn tracks() -> Vec<Track> {
        let video = super::super::tests::hevc_config(64, 48, 30);
        vec![
            Track {
                config: Mp4TrackConfig {
                    encoder: video,
                    format: Mp4TrackFormat::Video(
                        VideoDimensions::new(64, 48, &Limits::default()).unwrap(),
                    ),
                },
                priming: 0,
            },
            Track {
                config: Mp4TrackConfig {
                    encoder: EncoderConfig {
                        codec: Codec::Aac,
                        timescale: 48_000,
                        decoder_config: esds_box(&aac_lc_config(48_000, 2).unwrap(), 128_000),
                    },
                    format: Mp4TrackFormat::Audio { channels: 2 },
                },
                priming: 2112,
            },
        ]
    }

    fn sample(dts: i64, duration: u32, sync: bool, byte: u8) -> EncodedSample {
        EncodedSample {
            data: vec![byte; 10 + byte as usize],
            dts,
            pts: dts,
            duration,
            is_sync: sync,
            dependency: if sync {
                SampleDependency::INDEPENDENT
            } else {
                SampleDependency::DEPENDENT
            },
        }
    }

    /// Writes 3 fragments of 5 video frames and 7 AAC packets each.
    fn write(path: &Path) -> Written {
        let mut writer = FragmentedWriter::create(File::create(path).unwrap(), tracks()).unwrap();
        for fragment in 0..3 {
            for frame in 0..5 {
                let index = fragment * 5 + frame;
                writer
                    .push(0, sample(index, 1, frame == 0, index as u8))
                    .unwrap();
            }
            for packet in 0..7 {
                let index = fragment * 7 + packet;
                writer
                    .push(1, sample(index * 1024, 1024, true, 100 + index as u8))
                    .unwrap();
            }
            assert_eq!(writer.queued_ticks(0), 5);
            writer.flush_fragment().unwrap();
            assert_eq!(writer.queued_ticks(0), 0);
        }
        assert!(
            writer.push(0, sample(99, 1, true, 1)).is_err(),
            "gap in timestamps"
        );
        writer.finish().unwrap()
    }

    fn demux(bytes: Vec<u8>) -> (Mp4Demuxer, MemorySource) {
        let source = MemorySource::new(bytes);
        let movie = block_on(Mp4Demuxer::open(&source, Mp4DemuxerOptions::default())).unwrap();
        (movie, source)
    }

    fn check(movie: &Mp4Demuxer, source: &MemorySource, video: usize, audio: usize) {
        assert_eq!(movie.tracks.len(), 2);
        let (v, a) = (&movie.tracks[0], &movie.tracks[1]);
        assert_eq!((v.kind, a.kind), (TrackKind::Video, TrackKind::Audio));
        assert_eq!(v.samples.len(), video);
        assert_eq!(a.samples.len(), audio);
        assert_eq!(a.sample_rate, Some(48_000));
        for (index, sample) in v.samples.iter().enumerate() {
            assert_eq!(sample.dts, index as u64);
            assert_eq!(sample.is_sync, index % 5 == 0);
            let mut data = vec![0; sample.size as usize];
            block_on(v.read_sample_into(source, index, &mut data)).unwrap();
            assert_eq!(data, vec![index as u8; 10 + index]);
        }
        for (index, sample) in a.samples.iter().enumerate() {
            assert_eq!(sample.dts, index as u64 * 1024);
            let mut data = vec![0; sample.size as usize];
            block_on(a.read_sample_into(source, index, &mut data)).unwrap();
            assert_eq!(data[0], 100 + index as u8);
        }
    }

    #[test]
    fn writes_a_readable_fragmented_file() {
        let dir = tempdir();
        let path = dir.join("take.mp4");
        write(&path);
        let (movie, source) = demux(std::fs::read(&path).unwrap());
        check(&movie, &source, 15, 21);
    }

    #[test]
    fn a_file_cut_after_any_fragment_stays_readable() {
        let dir = tempdir();
        let path = dir.join("take.mp4");
        write(&path);
        let bytes = std::fs::read(&path).unwrap();
        // Find the fragment boundaries: each moof starts one.
        let mut ends = Vec::new();
        let mut offset = 0;
        while offset < bytes.len() {
            let size = u32::from_be_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
            if &bytes[offset + 4..offset + 8] == b"mdat" {
                ends.push(offset + size);
            }
            offset += size;
        }
        assert_eq!(ends.len(), 3);
        for (fragments, &end) in ends.iter().enumerate() {
            let (movie, source) = demux(bytes[..end].to_vec());
            check(&movie, &source, 5 * (fragments + 1), 7 * (fragments + 1));
        }
    }

    #[test]
    fn finalizes_into_an_ordinary_mp4() {
        let dir = tempdir();
        let path = dir.join("take.mp4");
        let written = write(&path);
        assert_eq!(written.sample_count(0), 15);
        // zvidlib's edit list is in 1/1000 s, so pick a padding that leaves
        // a whole number of milliseconds (393 ms) to read back exactly.
        let gapless = AudioGapless {
            priming: 2112,
            padding: 528,
        };
        finalize(&path, &written, &[(1, gapless)]).unwrap();
        assert!(!finalizing_path(&path).exists());
        let bytes = std::fs::read(&path).unwrap();
        assert!(!bytes.windows(4).any(|w| w == b"moof"), "no fragments left");
        let (movie, source) = demux(bytes);
        check(&movie, &source, 15, 21);
        let timing = movie.tracks[1].audio_timing(movie.movie_timescale).unwrap();
        assert_eq!((timing.priming, timing.padding), (2112, 528));
    }

    /// A fresh directory under the system temp directory.
    pub(crate) fn tempdir() -> PathBuf {
        use std::sync::atomic::{AtomicU32, Ordering};
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!(
            "zvid-record-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }
}
