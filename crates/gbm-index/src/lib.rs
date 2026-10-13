use gbm_file::{FileSource, Identity, Lines, LocalFile};
use redb::{Database, ReadOnlyTable, ReadableDatabase, ReadableTable, TableDefinition};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::{File, OpenOptions},
    io::{self, BufWriter, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock, Weak,
    },
};
const REFERENCES: TableDefinition<&str, &str> = TableDefinition::new("references");
fn db_error(e: impl std::fmt::Display) -> io::Error {
    io::Error::other(e.to_string())
}
fn shared_database(path: PathBuf) -> io::Result<Arc<Database>> {
    static OPEN: OnceLock<Mutex<HashMap<PathBuf, Weak<Database>>>> = OnceLock::new();
    let mut dbs = OPEN
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap();
    dbs.retain(|_, db| db.strong_count() > 0);
    if let Some(db) = dbs.get(&path).and_then(Weak::upgrade) {
        return Ok(db);
    }
    let db = Arc::new(
        Database::builder()
            .set_cache_size(8 * 1024 * 1024)
            .create(&path)
            .map_err(db_error)?,
    );
    dbs.insert(path, Arc::downgrade(&db));
    Ok(db)
}

pub const PAGE_SIZE: u64 = 64;
const HEADING_SIZE: u64 = 16;
pub const PAGE_TARGET: u64 = 32 * 1024;
pub const PAGE_LIMIT: u64 = 128 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct IndexStatus {
    pub scanned: u64,
    pub total: u64,
    pub pages: u64,
    pub headings: u64,
    pub complete: bool,
    pub cached: bool,
    pub error: Option<String>,
}
#[derive(Clone, Debug)]
pub struct Page {
    pub start: u64,
    pub end: u64,
    pub line: u64,
    pub mode: u8,
    pub language: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Heading {
    pub offset: u64,
    pub level: u8,
    pub title: String,
}
#[derive(Serialize, Deserialize)]
struct Manifest {
    version: u32,
    identity: Identity,
    status: IndexStatus,
}
pub struct DiskIndex {
    pub directory: PathBuf,
    pub status: Arc<Mutex<IndexStatus>>,
    pub cancel: Arc<AtomicBool>,
    references: Arc<Database>,
}
impl DiskIndex {
    pub fn new(root: &Path, source: &LocalFile) -> io::Result<Self> {
        let directory = root.join(&source.identity.fingerprint);
        std::fs::create_dir_all(&directory)?;
        let cached = std::fs::read(directory.join("manifest.json"))
            .ok()
            .and_then(|b| serde_json::from_slice::<Manifest>(&b).ok())
            .filter(|m| {
                m.version == 7
                    && m.identity == source.identity
                    && directory
                        .join("pages.bin")
                        .metadata()
                        .is_ok_and(|m2| m2.len() == m.status.pages * PAGE_SIZE)
                    && directory
                        .join("headings.bin")
                        .metadata()
                        .is_ok_and(|m2| m2.len() == m.status.headings * HEADING_SIZE)
                    && directory.join("references.redb").exists()
            });
        let mut status = cached.map(|m| m.status).unwrap_or(IndexStatus {
            total: source.size(),
            ..Default::default()
        });
        status.cached = status.complete;
        let references = shared_database(directory.join("references.redb"))?;
        if !status.complete {
            File::create(directory.join("pages.bin"))?;
            File::create(directory.join("headings.bin"))?;
            let tx = references.begin_write().map_err(db_error)?;
            tx.delete_table(REFERENCES).map_err(db_error)?;
            {
                tx.open_table(REFERENCES).map_err(db_error)?;
            }
            tx.commit().map_err(db_error)?;
        }
        Ok(Self {
            directory,
            status: Arc::new(Mutex::new(status)),
            cancel: Arc::new(AtomicBool::new(false)),
            references,
        })
    }
    pub fn reference_snapshot(&self) -> io::Result<ReadOnlyTable<&'static str, &'static str>> {
        self.references
            .begin_read()
            .map_err(db_error)?
            .open_table(REFERENCES)
            .map_err(db_error)
    }
    pub fn page(&self, number: u64) -> io::Result<Page> {
        let mut f = File::open(self.directory.join("pages.bin"))?;
        f.seek(SeekFrom::Start(number * PAGE_SIZE))?;
        let mut b = [0u8; 64];
        f.read_exact(&mut b)?;
        Ok(Page {
            start: u64::from_le_bytes(b[0..8].try_into().unwrap()),
            end: u64::from_le_bytes(b[8..16].try_into().unwrap()),
            line: u64::from_le_bytes(b[16..24].try_into().unwrap()),
            mode: b[24],
            language: String::from_utf8_lossy(&b[26..26 + b[25].min(32) as usize]).into_owned(),
        })
    }
    pub fn locate(&self, offset: u64) -> io::Result<Option<(u64, Page)>> {
        let count = self.status.lock().unwrap().pages;
        if count == 0 {
            return Ok(None);
        }
        let (mut lo, mut hi) = (0, count);
        while lo < hi {
            let mid = (lo + hi) / 2;
            if self.page(mid)?.end <= offset {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        if lo == count {
            return Ok(None);
        }
        Ok(Some((lo, self.page(lo)?)))
    }
    pub fn outline(
        &self,
        source: &LocalFile,
        start: u64,
        limit: usize,
    ) -> io::Result<Vec<Heading>> {
        let count = self.status.lock().unwrap().headings;
        let mut f = File::open(self.directory.join("headings.bin"))?;
        f.seek(SeekFrom::Start(start * HEADING_SIZE))?;
        let mut result = Vec::new();
        for _ in start..(start + limit.min(200) as u64).min(count) {
            let mut b = [0u8; 16];
            f.read_exact(&mut b)?;
            let offset = u64::from_le_bytes(b[..8].try_into().unwrap());
            let length = u32::from_le_bytes(b[8..12].try_into().unwrap()).min(4096) as usize;
            let text = source.encoding.decode(&source.read_at(offset, length)?).0;
            let title = if b[13] == 1 {
                text.trim()
                    .trim_start_matches('#')
                    .trim()
                    .trim_end_matches('#')
                    .trim()
            } else {
                text.trim()
            };
            result.push(Heading {
                offset,
                level: b[12],
                title: title.chars().take(512).collect(),
            });
        }
        Ok(result)
    }
    pub fn heading_position(&self, offset: u64) -> io::Result<u64> {
        let count = self.status.lock().unwrap().headings;
        if count == 0 {
            return Ok(0);
        }
        let mut f = File::open(self.directory.join("headings.bin"))?;
        let (mut lo, mut hi) = (0, count);
        while lo < hi {
            let mid = (lo + hi) / 2;
            f.seek(SeekFrom::Start(mid * HEADING_SIZE))?;
            let mut bytes = [0; 8];
            f.read_exact(&mut bytes)?;
            if u64::from_le_bytes(bytes) <= offset {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        Ok(lo.saturating_sub(1))
    }
    pub fn build(&self, source: &LocalFile) -> io::Result<()> {
        if self.status.lock().unwrap().complete {
            return Ok(());
        }
        let mut pages = BufWriter::new(
            OpenOptions::new()
                .write(true)
                .truncate(true)
                .open(self.directory.join("pages.bin"))?,
        );
        let mut headings = BufWriter::with_capacity(
            64 * 1024,
            OpenOptions::new()
                .write(true)
                .truncate(true)
                .open(self.directory.join("headings.bin"))?,
        );
        let mut definitions: Vec<(String, String, String)> = Vec::new();
        let mut definition_bytes = 0usize;
        let mut fence: Option<(u8, usize, String)> = None;
        let mut start_fence = fence.clone();
        let (mut start, mut line, mut start_line) = (source.bom, 1, 1);
        let mut previous: Option<u64> = None;
        let (mut page_count, mut heading_count, mut validated) = (0, 0, 0);
        let (mut in_list, mut start_list) = (false, false);
        let mut fragment = false;
        for item in Lines::new(source, source.bom) {
            if self.cancel.load(Ordering::Relaxed) {
                return Ok(());
            }
            let chunk = item?;
            let text = chunk.text.trim_end_matches(['\r', '\n']);
            let trimmed = text.trim_start_matches(' ');
            let indent = text.len() - trimmed.len();
            let mut closed_fence = false;
            let blank = text.trim().is_empty();
            if fence.is_none() && !blank && !fragment && !chunk.continued {
                let unordered = trimmed
                    .as_bytes()
                    .first()
                    .is_some_and(|b| b"-*+".contains(b))
                    && trimmed
                        .as_bytes()
                        .get(1)
                        .is_some_and(u8::is_ascii_whitespace);
                let digits = trimmed.bytes().take_while(u8::is_ascii_digit).count();
                let ordered = digits > 0
                    && digits <= 9
                    && trimmed
                        .as_bytes()
                        .get(digits)
                        .is_some_and(|b| *b == b'.' || *b == b')')
                    && trimmed
                        .as_bytes()
                        .get(digits + 1)
                        .is_some_and(u8::is_ascii_whitespace);
                if unordered || ordered {
                    in_list = true;
                } else if indent < 2 {
                    in_list = false;
                }
            }
            if !fragment && !chunk.continued && indent <= 3 {
                let marker = trimmed.as_bytes().first().copied().unwrap_or(0);
                let run = trimmed.bytes().take_while(|b| *b == marker).count();
                if let Some((fm, fl, _)) = &fence {
                    if marker == *fm && run >= *fl && trimmed[run..].trim().is_empty() {
                        fence = None;
                        closed_fence = true;
                    }
                } else if (marker == b'`' || marker == b'~')
                    && run >= 3
                    && !(marker == b'`' && trimmed[run..].contains('`'))
                {
                    fence = Some((
                        marker,
                        run,
                        trimmed[run..]
                            .split_whitespace()
                            .next()
                            .unwrap_or("")
                            .chars()
                            .take(32)
                            .collect(),
                    ));
                } else {
                    if marker == b'#'
                        && run <= 6
                        && (trimmed.len() == run || trimmed.as_bytes()[run].is_ascii_whitespace())
                    {
                        self.write_heading(
                            &mut headings,
                            chunk.start,
                            run as u8,
                            (chunk.end - chunk.start).min(4096) as u32,
                            true,
                        )?;
                        heading_count += 1;
                    } else if !trimmed.is_empty()
                        && trimmed
                            .bytes()
                            .all(|b| b == b'=' || b == b' ' || b == b'\t')
                        && marker == b'='
                    {
                        if let Some(offset) = previous.take() {
                            self.write_heading(
                                &mut headings,
                                offset,
                                1,
                                (chunk.start - offset).min(4096) as u32,
                                false,
                            )?;
                            heading_count += 1;
                        }
                    } else if !trimmed.is_empty()
                        && trimmed
                            .bytes()
                            .all(|b| b == b'-' || b == b' ' || b == b'\t')
                        && marker == b'-'
                    {
                        if let Some(offset) = previous.take() {
                            self.write_heading(
                                &mut headings,
                                offset,
                                2,
                                (chunk.start - offset).min(4096) as u32,
                                false,
                            )?;
                            heading_count += 1;
                        }
                    }
                    if trimmed.starts_with('[') && trimmed.contains("]:") && trimmed.len() < 4096 {
                        for def in gbm_parser::reference_definitions(trimmed) {
                            definition_bytes += def.0.len() + def.1.len() + def.2.len();
                            definitions.push(def);
                        }
                    }
                }
            }
            let length = chunk.end - start;
            let safe = blank && fence.is_none() && !in_list && !chunk.continued;
            let code_end = closed_fence && start_fence.is_some();
            if (length >= PAGE_TARGET && safe) || length >= PAGE_LIMIT || code_end {
                let mode = if code_end {
                    3
                } else if safe && start_fence.is_none() && !start_list {
                    0
                } else if start_fence.is_some() && fence.is_some() {
                    1
                } else {
                    2
                };
                let language = start_fence
                    .as_ref()
                    .map(|f| f.2.clone())
                    .unwrap_or_default();
                write_page(
                    &mut pages,
                    &Page {
                        start,
                        end: chunk.end,
                        line: start_line,
                        mode,
                        language,
                    },
                )?;
                page_count += 1;
                pages.flush()?;
                headings.flush()?;
                let mut s = self.status.lock().unwrap();
                s.pages = page_count;
                s.headings = heading_count;
                s.scanned = chunk.end;
                start = chunk.end;
                start_line = line + 1;
                start_fence = fence.clone();
                start_list = in_list;
            }
            if fence.is_none()
                && !blank
                && indent <= 3
                && !fragment
                && !chunk.continued
                && !trimmed.starts_with(['#', '>', '[', '-', '*', '`', '~'])
            {
                previous = Some(chunk.start);
            } else {
                previous = None;
            }
            fragment = chunk.continued;
            if !chunk.continued {
                line += 1;
            }
            if chunk.end.saturating_sub(validated) >= 8 * 1024 * 1024 {
                if source.changed() {
                    return Err(io::Error::other("Source changed during indexing"));
                }
                validated = chunk.end;
                std::thread::yield_now();
            }
            if definition_bytes >= 64 * 1024 {
                self.commit_definitions(&mut definitions)?;
                definition_bytes = 0;
            }
        }
        if start < source.size() {
            write_page(
                &mut pages,
                &Page {
                    start,
                    end: source.size(),
                    line: start_line,
                    mode: if start_fence.is_some() {
                        1
                    } else if start_list {
                        2
                    } else {
                        0
                    },
                    language: start_fence.map(|f| f.2).unwrap_or_default(),
                },
            )?;
            page_count += 1;
        }
        if source.changed() {
            return Err(io::Error::other("Source changed during indexing"));
        }
        self.commit_definitions(&mut definitions)?;
        pages.flush()?;
        headings.flush()?;
        pages.get_ref().sync_all()?;
        headings.get_ref().sync_all()?;
        let status = {
            let mut s = self.status.lock().unwrap();
            s.pages = page_count;
            s.headings = heading_count;
            s.scanned = source.size();
            s.complete = true;
            s.clone()
        };
        let manifest = Manifest {
            version: 7,
            identity: source.identity.clone(),
            status,
        };
        std::fs::write(
            self.directory.join("manifest.json"),
            serde_json::to_vec(&manifest)?,
        )?;
        Ok(())
    }
    fn commit_definitions(
        &self,
        definitions: &mut Vec<(String, String, String)>,
    ) -> io::Result<()> {
        if definitions.is_empty() {
            return Ok(());
        }
        let tx = self.references.begin_write().map_err(db_error)?;
        {
            let mut table = tx.open_table(REFERENCES).map_err(db_error)?;
            for (label, url, title) in definitions.drain(..) {
                if table.get(label.as_str()).map_err(db_error)?.is_none() {
                    let value = serde_json::to_string(&(url, title))?;
                    table
                        .insert(label.as_str(), value.as_str())
                        .map_err(db_error)?;
                }
            }
        }
        tx.commit().map_err(db_error)
    }
    fn write_heading(
        &self,
        f: &mut impl Write,
        offset: u64,
        level: u8,
        length: u32,
        atx: bool,
    ) -> io::Result<()> {
        let mut b = [0u8; 16];
        b[..8].copy_from_slice(&offset.to_le_bytes());
        b[8..12].copy_from_slice(&length.to_le_bytes());
        b[12] = level;
        b[13] = u8::from(atx);
        f.write_all(&b)?;
        Ok(())
    }
}
fn write_page(f: &mut impl Write, p: &Page) -> io::Result<()> {
    let mut b = [0u8; 64];
    b[..8].copy_from_slice(&p.start.to_le_bytes());
    b[8..16].copy_from_slice(&p.end.to_le_bytes());
    b[16..24].copy_from_slice(&p.line.to_le_bytes());
    b[24] = p.mode;
    let n = p.language.len().min(32);
    b[25] = n as u8;
    b[26..26 + n].copy_from_slice(&p.language.as_bytes()[..n]);
    f.write_all(&b)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn disk_pages_cover_giant_fence_and_outline_excludes_code() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("doc.md");
        std::fs::write(
            &path,
            format!(
                "# Real\n\n```rust\n{}\n```\n\n# End\n",
                "# fake\n".repeat(70000)
            ),
        )
        .unwrap();
        let source = LocalFile::open(&path).unwrap();
        let index = DiskIndex::new(&dir.path().join("cache"), &source).unwrap();
        index.build(&source).unwrap();
        assert_eq!(index.outline(&source, 0, 100).unwrap().len(), 2);
        let status = index.status.lock().unwrap().clone();
        let mut end = source.bom;
        for n in 0..status.pages {
            let p = index.page(n).unwrap();
            assert_eq!(p.start, end);
            assert!(p.end - p.start <= PAGE_LIMIT + 65536);
            end = p.end;
        }
        assert_eq!(end, source.size());
        assert_eq!(index.page(1).unwrap().mode, 1);
        let cached = DiskIndex::new(&dir.path().join("cache"), &source).unwrap();
        assert!(cached.status.lock().unwrap().cached);
    }
}
