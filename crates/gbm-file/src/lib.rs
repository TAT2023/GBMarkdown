use serde::{Deserialize, Serialize};
use std::{
    fs::File,
    io,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

pub const SCAN_BUFFER: usize = 8 * 1024 * 1024;
pub const LINE_LIMIT: usize = 64 * 1024;

pub trait FileSource: Send + Sync {
    fn size(&self) -> u64;
    fn read_at(&self, offset: u64, length: usize) -> io::Result<Vec<u8>>;
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
pub enum Encoding {
    Utf8,
    Utf16Le,
    Utf16Be,
}
impl Encoding {
    pub fn label(self) -> &'static str {
        match self {
            Self::Utf8 => "UTF-8",
            Self::Utf16Le => "UTF-16 LE",
            Self::Utf16Be => "UTF-16 BE",
        }
    }
    pub fn unit(self) -> usize {
        if self == Self::Utf8 {
            1
        } else {
            2
        }
    }
    pub fn decode(self, bytes: &[u8]) -> (String, bool) {
        if self == Self::Utf8 {
            let invalid = std::str::from_utf8(bytes).is_err();
            (String::from_utf8_lossy(bytes).into_owned(), invalid)
        } else {
            let words: Vec<u16> = bytes
                .as_chunks::<2>()
                .0
                .iter()
                .map(|p| {
                    if self == Self::Utf16Le {
                        u16::from_le_bytes([p[0], p[1]])
                    } else {
                        u16::from_be_bytes([p[0], p[1]])
                    }
                })
                .collect();
            let invalid = !bytes.len().is_multiple_of(2)
                || char::decode_utf16(words.iter().copied()).any(|c| c.is_err());
            (String::from_utf16_lossy(&words), invalid)
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Identity {
    pub size: u64,
    pub modified: u128,
    pub fingerprint: String,
}

pub struct LocalFile {
    file: File,
    pub path: PathBuf,
    pub identity: Identity,
    pub encoding: Encoding,
    pub bom: u64,
}
impl LocalFile {
    pub fn open(path: &Path) -> io::Result<Self> {
        let path = path.canonicalize()?;
        let file = File::open(&path)?;
        let meta = file.metadata()?;
        if !meta.is_file() {
            return Err(io::Error::other("Please open a regular file"));
        }
        let mut source = Self {
            file,
            path,
            identity: Identity {
                size: meta.len(),
                modified: meta
                    .modified()?
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos(),
                fingerprint: String::new(),
            },
            encoding: Encoding::Utf8,
            bom: 0,
        };
        let first = source.read_at(0, 4096)?;
        if first.starts_with(&[0xff, 0xfe]) {
            source.encoding = Encoding::Utf16Le;
            source.bom = 2;
        } else if first.starts_with(&[0xfe, 0xff]) {
            source.encoding = Encoding::Utf16Be;
            source.bom = 2;
        } else if first.starts_with(&[0xef, 0xbb, 0xbf]) {
            source.bom = 3;
        }
        let mut hash = blake3::Hasher::new();
        hash.update(source.path.to_string_lossy().as_bytes());
        hash.update(&first);
        hash.update(&source.read_at(source.size() / 2, 4096)?);
        hash.update(&source.read_at(source.size().saturating_sub(4096), 4096)?);
        hash.update(&source.size().to_le_bytes());
        hash.update(&source.identity.modified.to_le_bytes());
        source.identity.fingerprint = hash.finalize().to_hex().to_string();
        Ok(source)
    }
    pub fn changed(&self) -> bool {
        std::fs::metadata(&self.path)
            .map(|m| {
                m.len() != self.size()
                    || m.modified()
                        .ok()
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_nanos())
                        != Some(self.identity.modified)
            })
            .unwrap_or(true)
    }
    pub fn text(&self, start: u64, end: u64) -> io::Result<(String, bool)> {
        let bytes = self.read_at(start, end.saturating_sub(start).min(256 * 1024) as usize)?;
        Ok(self.encoding.decode(&bytes))
    }
}
impl FileSource for LocalFile {
    fn size(&self) -> u64 {
        self.identity.size
    }
    fn read_at(&self, offset: u64, length: usize) -> io::Result<Vec<u8>> {
        let len = (self.size().saturating_sub(offset)).min(length as u64) as usize;
        let mut bytes = vec![0; len];
        let mut filled = 0;
        while filled < len {
            #[cfg(windows)]
            let n = {
                use std::os::windows::fs::FileExt;
                self.file
                    .seek_read(&mut bytes[filled..], offset + filled as u64)?
            };
            #[cfg(unix)]
            let n = {
                use std::os::unix::fs::FileExt;
                self.file
                    .read_at(&mut bytes[filled..], offset + filled as u64)?
            };
            if n == 0 {
                break;
            }
            filled += n;
        }
        bytes.truncate(filled);
        Ok(bytes)
    }
}

pub struct LineChunk {
    pub start: u64,
    pub end: u64,
    pub text: String,
    pub continued: bool,
}
pub struct Lines<'a> {
    source: &'a LocalFile,
    buffer: Vec<u8>,
    cursor: usize,
    base: u64,
    next: u64,
}
impl<'a> Lines<'a> {
    pub fn new(source: &'a LocalFile, offset: u64) -> Self {
        Self {
            source,
            buffer: Vec::new(),
            cursor: 0,
            base: offset,
            next: offset,
        }
    }
}
impl Iterator for Lines<'_> {
    type Item = io::Result<LineChunk>;
    fn next(&mut self) -> Option<Self::Item> {
        if self.next >= self.source.size() {
            return None;
        }
        let start = self.next;
        let unit = self.source.encoding.unit();
        let mut bytes = Vec::with_capacity(256);
        let mut newline = false;
        while bytes.len() < LINE_LIMIT {
            if self.cursor >= self.buffer.len() {
                self.base = self.next;
                match self.source.read_at(self.base, SCAN_BUFFER) {
                    Ok(b) => self.buffer = b,
                    Err(e) => return Some(Err(e)),
                }
                self.cursor = 0;
                if self.buffer.is_empty() {
                    break;
                }
            }
            let available = (self.buffer.len() - self.cursor).min(LINE_LIMIT - bytes.len());
            let slice = &self.buffer[self.cursor..self.cursor + available];
            let found = if unit == 1 {
                slice.iter().position(|b| *b == b'\n').map(|i| i + 1)
            } else {
                slice
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .position(|p| {
                        if self.source.encoding == Encoding::Utf16Le {
                            *p == [10, 0]
                        } else {
                            *p == [0, 10]
                        }
                    })
                    .map(|i| (i + 1) * 2)
            };
            let mut count = found.unwrap_or(available);
            // A forced chunk boundary must not cut a valid Unicode scalar.
            if found.is_none() && bytes.len() + count >= LINE_LIMIT {
                if unit == 1 {
                    while count > 0
                        && self
                            .buffer
                            .get(self.cursor + count)
                            .is_some_and(|b| b & 0xc0 == 0x80)
                    {
                        count -= 1;
                    }
                } else if count >= 2 {
                    let p = &slice[count - 2..count];
                    let word = if self.source.encoding == Encoding::Utf16Le {
                        u16::from_le_bytes([p[0], p[1]])
                    } else {
                        u16::from_be_bytes([p[0], p[1]])
                    };
                    if (0xd800..=0xdbff).contains(&word) {
                        count -= 2;
                    }
                }
            }
            if count == 0 {
                break;
            }
            bytes.extend_from_slice(&slice[..count]);
            self.cursor += count;
            self.next += count as u64;
            if found.is_some() {
                newline = true;
                break;
            }
            if count < available {
                break;
            }
        }
        Some(Ok(LineChunk {
            start,
            end: self.next,
            text: self.source.encoding.decode(&bytes).0,
            continued: !newline && self.next < self.source.size(),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    #[test]
    fn unicode_and_long_line_are_bounded() {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        let input = format!("{}\r\n# next\n", "中文😀".repeat(20000));
        f.write_all(input.as_bytes()).unwrap();
        let s = LocalFile::open(f.path()).unwrap();
        let chunks: Vec<_> = Lines::new(&s, 0).map(Result::unwrap).collect();
        assert!(chunks.iter().all(|c| c.end - c.start <= LINE_LIMIT as u64));
        assert_eq!(
            chunks.iter().map(|c| c.text.as_str()).collect::<String>(),
            input
        );
    }
    #[test]
    fn utf16_offsets_are_bytes() {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        f.write_all(&[0xff, 0xfe]).unwrap();
        for w in "# 中文\r\nhello😀".encode_utf16() {
            f.write_all(&w.to_le_bytes()).unwrap();
        }
        let s = LocalFile::open(f.path()).unwrap();
        let chunks: Vec<_> = Lines::new(&s, s.bom).map(Result::unwrap).collect();
        assert_eq!(chunks[0].start, 2);
        assert_eq!(chunks.last().unwrap().end, s.size());
        assert_eq!(
            chunks.iter().map(|c| c.text.as_str()).collect::<String>(),
            "# 中文\r\nhello😀"
        );
    }
}
