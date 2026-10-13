use gbm_file::{Encoding, FileSource, LocalFile};
use serde::{Deserialize, Serialize};
use std::{
    io,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

pub const RESULT_LIMIT: usize = 10000;
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SearchMatch {
    pub offset: u64,
    pub end: u64,
    pub preview: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct SearchStatus {
    pub scanned: u64,
    pub total: u64,
    pub count: u64,
    pub retained: usize,
    pub complete: bool,
    pub cancelled: bool,
    pub truncated: bool,
    pub error: Option<String>,
}
pub struct SearchJob {
    pub cancel: AtomicBool,
    pub status: Mutex<SearchStatus>,
    pub results: Mutex<Vec<SearchMatch>>,
}
impl SearchJob {
    pub fn new(total: u64) -> Arc<Self> {
        Arc::new(Self {
            cancel: AtomicBool::new(false),
            status: Mutex::new(SearchStatus {
                total,
                ..Default::default()
            }),
            results: Mutex::new(Vec::new()),
        })
    }
    pub fn run(&self, source: &LocalFile, query: &str, case_sensitive: bool) -> io::Result<()> {
        if query.is_empty() || query.len() > 4096 {
            return Err(io::Error::other(
                "Search text must contain 1 to 4096 UTF-8 bytes",
            ));
        }
        if case_sensitive && source.encoding == Encoding::Utf8 {
            return self.run_utf8(source, query);
        }
        let needle = if case_sensitive {
            query.to_owned()
        } else {
            query.to_lowercase()
        };
        let mut offset = source.bom;
        let mut carry = String::new();
        let mut carry_map: Vec<u64> = Vec::new();
        let mut last_end = 0;
        while offset < source.size() {
            if self.cancel.load(Ordering::Relaxed) {
                let mut s = self.status.lock().unwrap();
                s.cancelled = true;
                s.complete = true;
                return Ok(());
            }
            let mut bytes = source.read_at(offset, 1024 * 1024)?;
            if bytes.is_empty() {
                break;
            }
            if offset + (bytes.len() as u64) < source.size() {
                if source.encoding == Encoding::Utf8 {
                    if let Err(e) = std::str::from_utf8(&bytes) {
                        if e.error_len().is_none() {
                            bytes.truncate(e.valid_up_to());
                        }
                    }
                } else {
                    let n = bytes.len();
                    if n >= 2 {
                        let w = if source.encoding == Encoding::Utf16Le {
                            u16::from_le_bytes([bytes[n - 2], bytes[n - 1]])
                        } else {
                            u16::from_be_bytes([bytes[n - 2], bytes[n - 1]])
                        };
                        if (0xd800..=0xdbff).contains(&w) {
                            bytes.truncate(n - 2);
                        }
                    }
                }
            }
            let mut text = carry;
            let mut map = carry_map;
            append_mapped(
                &bytes,
                source.encoding,
                offset,
                case_sensitive,
                &mut text,
                &mut map,
            );
            let next = offset + bytes.len() as u64;
            let mut cursor = 0;
            while let Some(relative) = text[cursor..].find(&needle) {
                let pos = cursor + relative;
                let end = pos + needle.len();
                let begin_offset = map[pos];
                let end_offset = if end < map.len() { map[end] } else { next };
                if end_offset > last_end {
                    let mut s = self.status.lock().unwrap();
                    s.count += 1;
                    if s.retained < RESULT_LIMIT {
                        let mut left = pos.saturating_sub(70);
                        while !text.is_char_boundary(left) {
                            left += 1;
                        }
                        let mut right = (end + 100).min(text.len());
                        while !text.is_char_boundary(right) {
                            right -= 1;
                        }
                        let preview = text[left..right].replace(['\r', '\n'], " ");
                        self.results.lock().unwrap().push(SearchMatch {
                            offset: begin_offset,
                            end: end_offset,
                            preview,
                        });
                        s.retained += 1;
                    } else {
                        s.truncated = true;
                    }
                    last_end = end_offset;
                }
                cursor = end;
                if cursor >= text.len() {
                    break;
                }
            }
            let mut tail = text.len().saturating_sub(needle.len().saturating_sub(1));
            while !text.is_char_boundary(tail) {
                tail += 1;
            }
            carry = text[tail..].to_owned();
            carry_map = map[tail..].to_vec();
            offset = next;
            self.status.lock().unwrap().scanned = offset;
            if source.changed() {
                return Err(io::Error::other("Source changed during search"));
            }
            std::thread::yield_now();
        }
        let mut s = self.status.lock().unwrap();
        s.scanned = source.size();
        s.complete = true;
        Ok(())
    }
    fn run_utf8(&self, source: &LocalFile, query: &str) -> io::Result<()> {
        let finder = memchr::memmem::Finder::new(query.as_bytes());
        let mut carry = Vec::new();
        let mut offset = source.bom;
        let mut last_end = 0;
        while offset < source.size() {
            if self.cancel.load(Ordering::Relaxed) {
                let mut s = self.status.lock().unwrap();
                s.cancelled = true;
                s.complete = true;
                return Ok(());
            }
            let bytes = source.read_at(offset, 1024 * 1024)?;
            if bytes.is_empty() {
                break;
            }
            let base = offset - carry.len() as u64;
            let mut data = carry;
            data.extend_from_slice(&bytes);
            let mut count = 0;
            let mut matches = Vec::new();
            let retained = self.status.lock().unwrap().retained;
            for pos in finder.find_iter(&data) {
                let end = base + (pos + query.len()) as u64;
                if end <= last_end {
                    continue;
                }
                last_end = end;
                count += 1;
                if retained + matches.len() < RESULT_LIMIT {
                    let preview = String::from_utf8_lossy(
                        &data[pos.saturating_sub(70)..(pos + query.len() + 100).min(data.len())],
                    )
                    .replace(['\r', '\n'], " ");
                    matches.push(SearchMatch {
                        offset: base + pos as u64,
                        end,
                        preview,
                    });
                }
            }
            offset += bytes.len() as u64;
            let tail = data.len().saturating_sub(query.len() - 1);
            carry = data[tail..].to_vec();
            {
                let mut s = self.status.lock().unwrap();
                s.count += count;
                s.retained += matches.len();
                s.truncated = s.count > RESULT_LIMIT as u64;
                s.scanned = offset;
                self.results.lock().unwrap().extend(matches);
            }
            if source.changed() {
                return Err(io::Error::other("Source changed during search"));
            }
            std::thread::yield_now();
        }
        let mut s = self.status.lock().unwrap();
        s.scanned = source.size();
        s.complete = true;
        Ok(())
    }
}
fn append_mapped(
    bytes: &[u8],
    encoding: Encoding,
    base: u64,
    sensitive: bool,
    text: &mut String,
    map: &mut Vec<u64>,
) {
    let mut append = |c: char, start: usize| {
        if sensitive {
            text.push(c);
            map.extend(std::iter::repeat_n(base + start as u64, c.len_utf8()));
        } else {
            for lower in c.to_lowercase() {
                text.push(lower);
                map.extend(std::iter::repeat_n(base + start as u64, lower.len_utf8()));
            }
        }
    };
    if encoding == Encoding::Utf8 {
        let mut position = 0;
        while position < bytes.len() {
            let (valid, invalid) = match std::str::from_utf8(&bytes[position..]) {
                Ok(s) => (s, None),
                Err(e) => (
                    std::str::from_utf8(&bytes[position..position + e.valid_up_to()]).unwrap(),
                    Some(
                        e.error_len()
                            .unwrap_or(bytes.len() - position - e.valid_up_to()),
                    ),
                ),
            };
            for (i, c) in valid.char_indices() {
                append(c, position + i);
            }
            position += valid.len();
            if let Some(n) = invalid {
                append('\u{fffd}', position);
                position += n;
            }
        }
    } else {
        let word = |i: usize| {
            if encoding == Encoding::Utf16Le {
                u16::from_le_bytes([bytes[i], bytes[i + 1]])
            } else {
                u16::from_be_bytes([bytes[i], bytes[i + 1]])
            }
        };
        let mut i = 0;
        while i + 1 < bytes.len() {
            let start = i;
            let w = word(i);
            i += 2;
            let c = if (0xd800..=0xdbff).contains(&w)
                && i + 1 < bytes.len()
                && (0xdc00..=0xdfff).contains(&word(i))
            {
                let low = word(i);
                i += 2;
                char::from_u32(0x10000 + ((w as u32 - 0xd800) << 10) + (low as u32 - 0xdc00))
                    .unwrap()
            } else {
                char::from_u32(w as u32).unwrap_or('\u{fffd}')
            };
            append(c, start);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unicode_cross_buffer_and_cancel() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("search.md");
        let prefix = "a".repeat(1024 * 1024 - 2);
        std::fs::write(&p, format!("{prefix}中文ABC中文\n")).unwrap();
        let f = LocalFile::open(&p).unwrap();
        let job = SearchJob::new(f.size());
        job.run(&f, "中文abc", false).unwrap();
        assert_eq!(job.results.lock().unwrap()[0].offset, prefix.len() as u64);
        let job = SearchJob::new(f.size());
        job.cancel.store(true, Ordering::Relaxed);
        job.run(&f, "a", true).unwrap();
        assert!(job.status.lock().unwrap().cancelled);
    }
    #[test]
    fn utf16_case_mapping() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("utf.md");
        let mut b = vec![0xfe, 0xff];
        for w in "中文😀 ABC abc".encode_utf16() {
            b.extend(w.to_be_bytes());
        }
        std::fs::write(&p, b).unwrap();
        let f = LocalFile::open(&p).unwrap();
        let job = SearchJob::new(f.size());
        job.run(&f, "abc", false).unwrap();
        let r = job.results.lock().unwrap();
        assert_eq!(r.len(), 2);
        assert_eq!(r[0].offset, 12);
    }
}
