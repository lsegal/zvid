//! HTTP `Range` handling for `zvid://take/<id>`, so `<video>` can seek
//! without the whole take being read into memory.

/// Most bytes served for one open-ended range (`bytes=N-`). Media elements
/// ask again for the rest, so this bounds memory per request.
pub const MAX_CHUNK: u64 = 4 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ByteRange {
    pub start: u64,
    /// Inclusive.
    pub end: u64,
}

impl ByteRange {
    pub fn len(&self) -> u64 {
        self.end - self.start + 1
    }

    pub fn is_empty(&self) -> bool {
        false
    }

    pub fn content_range(&self, total: u64) -> String {
        format!("bytes {}-{}/{total}", self.start, self.end)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RangeRequest {
    /// No usable `Range` header: serve the file from the start.
    Full,
    Partial(ByteRange),
    /// 416 Range Not Satisfiable.
    Unsatisfiable,
}

/// Resolves a `Range` header against a file of `total` bytes. Only the first
/// range of a multi-range request is honored, and every range is capped at
/// [`MAX_CHUNK`] bytes.
pub fn resolve(header: Option<&str>, total: u64) -> RangeRequest {
    let Some(spec) = header.and_then(|header| header.trim().strip_prefix("bytes=")) else {
        return RangeRequest::Full;
    };
    let first = spec.split(',').next().unwrap_or("").trim();
    let Some((start, end)) = first.split_once('-') else {
        return RangeRequest::Full;
    };
    let (start, end) = (start.trim(), end.trim());
    let range = match (start.parse::<u64>(), end.parse::<u64>()) {
        (Ok(start), Ok(end)) if start <= end => (start, end.min(total.saturating_sub(1))),
        (Ok(start), Err(_)) if end.is_empty() => (start, total.saturating_sub(1)),
        (Err(_), Ok(suffix)) if start.is_empty() && suffix > 0 => {
            (total.saturating_sub(suffix), total.saturating_sub(1))
        }
        _ => return RangeRequest::Full,
    };
    if total == 0 || range.0 >= total {
        return RangeRequest::Unsatisfiable;
    }
    RangeRequest::Partial(ByteRange {
        start: range.0,
        end: range.1.min(range.0 + MAX_CHUNK - 1),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn partial(start: u64, end: u64) -> RangeRequest {
        RangeRequest::Partial(ByteRange { start, end })
    }

    #[test]
    fn resolves_the_common_forms() {
        assert_eq!(resolve(Some("bytes=0-99"), 1000), partial(0, 99));
        assert_eq!(resolve(Some("bytes=900-"), 1000), partial(900, 999));
        assert_eq!(resolve(Some("bytes=-100"), 1000), partial(900, 999));
        assert_eq!(resolve(Some("bytes=-5000"), 1000), partial(0, 999));
        assert_eq!(resolve(Some("bytes=990-2000"), 1000), partial(990, 999));
        assert_eq!(resolve(Some(" bytes=0-1, 5-9"), 1000), partial(0, 1));
    }

    #[test]
    fn caps_open_ended_ranges() {
        let total = MAX_CHUNK * 3;
        assert_eq!(resolve(Some("bytes=0-"), total), partial(0, MAX_CHUNK - 1));
        assert_eq!(
            resolve(Some(&format!("bytes={MAX_CHUNK}-")), total),
            partial(MAX_CHUNK, 2 * MAX_CHUNK - 1)
        );
    }

    #[test]
    fn falls_back_or_refuses() {
        assert_eq!(resolve(None, 1000), RangeRequest::Full);
        assert_eq!(resolve(Some("items=0-1"), 1000), RangeRequest::Full);
        assert_eq!(resolve(Some("bytes=abc"), 1000), RangeRequest::Full);
        assert_eq!(resolve(Some("bytes=5-1"), 1000), RangeRequest::Full);
        assert_eq!(resolve(Some("bytes=-0"), 1000), RangeRequest::Full);
        assert_eq!(
            resolve(Some("bytes=1000-"), 1000),
            RangeRequest::Unsatisfiable
        );
        assert_eq!(resolve(Some("bytes=0-"), 0), RangeRequest::Unsatisfiable);
    }

    #[test]
    fn formats_content_range() {
        let range = ByteRange { start: 10, end: 19 };
        assert_eq!(range.len(), 10);
        assert_eq!(range.content_range(100), "bytes 10-19/100");
    }
}
