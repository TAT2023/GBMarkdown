use gbm_file::{FileSource, Lines, LocalFile};
use gbm_index::{DiskIndex, Heading, IndexStatus, PAGE_LIMIT, PAGE_TARGET};
pub use gbm_render::RenderBlock;
use gbm_search::SearchJob;
pub use gbm_search::{SearchMatch, SearchStatus};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    io,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentInfo {
    pub id: String,
    pub path: String,
    pub name: String,
    pub size: u64,
    pub encoding: String,
    pub bom: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderWindow {
    pub start: u64,
    pub end: u64,
    pub blocks: Vec<RenderBlock>,
    pub request_version: u64,
    pub warning: Option<String>,
}
pub struct LocalImage {
    pub bytes: Vec<u8>,
    pub width: usize,
    pub height: usize,
}
struct RenderCache {
    entries: VecDeque<(u64, RenderBlock)>,
    bytes: usize,
}
impl RenderCache {
    fn get(&mut self, key: u64) -> Option<RenderBlock> {
        let i = self.entries.iter().position(|(k, _)| *k == key)?;
        let pair = self.entries.remove(i)?;
        let block = pair.1.clone();
        self.entries.push_back(pair);
        Some(block)
    }
    fn put(&mut self, key: u64, block: RenderBlock) {
        self.bytes += block.html.len();
        self.entries.push_back((key, block));
        while self.bytes > 16 * 1024 * 1024 || self.entries.len() > 128 {
            if let Some((_, b)) = self.entries.pop_front() {
                self.bytes -= b.html.len();
            } else {
                break;
            }
        }
    }
}
pub struct Document {
    pub info: DocumentInfo,
    pub source: Arc<LocalFile>,
    pub index: Arc<DiskIndex>,
    workers: Mutex<Vec<JoinHandle<()>>>,
    searches: Mutex<HashMap<String, Arc<SearchJob>>>,
    search_gate: Mutex<()>,
    closed: AtomicBool,
    cache: Mutex<RenderCache>,
    serial: AtomicU64,
}
impl Document {
    pub fn open(path: &Path, root: &Path, id: String) -> io::Result<Arc<Self>> {
        let source = Arc::new(LocalFile::open(path)?);
        let index = Arc::new(DiskIndex::new(root, &source)?);
        let info = DocumentInfo {
            id,
            path: source
                .path
                .to_string_lossy()
                .trim_start_matches("\\\\?\\")
                .into(),
            name: source
                .path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into(),
            size: source.size(),
            encoding: source.encoding.label().into(),
            bom: source.bom,
        };
        let doc = Arc::new(Self {
            info,
            source: source.clone(),
            index: index.clone(),
            workers: Mutex::new(Vec::new()),
            searches: Mutex::new(HashMap::new()),
            search_gate: Mutex::new(()),
            closed: AtomicBool::new(false),
            cache: Mutex::new(RenderCache {
                entries: VecDeque::new(),
                bytes: 0,
            }),
            serial: AtomicU64::new(0),
        });
        if !index.status.lock().unwrap().complete {
            let worker = thread::Builder::new()
                .name("gbm-index".into())
                .spawn(move || {
                    if let Err(e) = index.build(&source) {
                        let mut s = index.status.lock().unwrap();
                        s.error = Some(e.to_string());
                    }
                })?;
            doc.workers.lock().unwrap().push(worker);
        }
        Ok(doc)
    }
    pub fn status(&self) -> IndexStatus {
        self.index.status.lock().unwrap().clone()
    }
    pub fn changed(&self) -> bool {
        self.source.changed()
    }
    pub fn outline(&self, start: u64, limit: usize) -> io::Result<Vec<Heading>> {
        self.index.outline(&self.source, start, limit)
    }
    pub fn resolve_anchor(&self, fragment: &str) -> io::Result<Option<u64>> {
        if self.closed.load(Ordering::Relaxed) || self.changed() {
            return Err(io::Error::other(
                "Document closed or changed; reload before navigating",
            ));
        }
        if let Some(error) = self.status().error {
            return Err(io::Error::other(error));
        }
        if fragment.is_empty() {
            return Ok(Some(self.source.bom));
        }
        self.index.resolve_anchor(fragment)
    }
    pub fn render_window(
        &self,
        offset: u64,
        max_bytes: usize,
        version: u64,
    ) -> io::Result<RenderWindow> {
        if self.closed.load(Ordering::Relaxed) {
            return Err(io::Error::other("Document closed"));
        }
        if self.changed() {
            return Err(io::Error::other(
                "Source file changed; reload before continuing",
            ));
        }
        let offset = offset
            .min(self.source.size().saturating_sub(1))
            .max(self.source.bom);
        let budget = max_bytes.clamp(32 * 1024, 256 * 1024) as u64;
        let mut blocks = Vec::new();
        let mut warning = None;
        if let Some((n, page)) = self.index.locate(offset)? {
            let count = self.status().pages;
            let mut total = 0;
            for number in n..(n + 8).min(count) {
                let page = if number == n {
                    page.clone()
                } else {
                    self.index.page(number)?
                };
                if total > 0 && total + page.end - page.start > budget {
                    break;
                }
                total += page.end - page.start;
                let complete = self.status().complete;
                let cached = if complete {
                    self.cache.lock().unwrap().get(page.start)
                } else {
                    None
                };
                let block = if let Some(b) = cached {
                    b
                } else {
                    let (text, invalid) = self.source.text(page.start, page.end)?;
                    if invalid {
                        warning = Some(
                            "Invalid encoding was replaced with readable replacement characters"
                                .into(),
                        );
                    }
                    let table = self.index.reference_snapshot()?;
                    let b = gbm_render::render_encoded(
                        page.start,
                        page.end,
                        page.line,
                        &text,
                        page.mode,
                        &page.language,
                        self.source.encoding != gbm_file::Encoding::Utf8,
                        |label| {
                            table
                                .get(label)
                                .ok()
                                .flatten()
                                .and_then(|v| serde_json::from_str(v.value()).ok())
                        },
                    );
                    if complete {
                        self.cache.lock().unwrap().put(page.start, b.clone());
                    }
                    b
                };
                if block.mode == "compatibility" {
                    warning = Some("Oversized block: bounded plain-text compatibility view".into());
                }
                blocks.push(block);
            }
        } else if offset <= self.source.bom || offset < 256 * 1024 {
            let mut text = String::new();
            let mut end = self.source.bom;
            let mut cut = false;
            let mut in_math = false;
            for line in Lines::new(&self.source, self.source.bom) {
                let c = line?;
                text.push_str(&c.text);
                end = c.end;
                if c.text.trim() == "$$" {
                    in_math = !in_math;
                }
                if end - self.source.bom >= PAGE_TARGET && c.text.trim().is_empty() && !in_math {
                    break;
                }
                if end - self.source.bom >= PAGE_LIMIT {
                    cut = true;
                    break;
                }
            }
            blocks.push(gbm_render::render_encoded(
                self.source.bom,
                end,
                1,
                &text,
                if cut { 2 } else { 0 },
                "",
                self.source.encoding != gbm_file::Encoding::Utf8,
                |_| None,
            ));
        } else {
            let mut start = offset.saturating_sub(8192);
            start -= start % self.source.encoding.unit() as u64;
            let sample = self.source.read_at(start, 64)?;
            if self.source.encoding == gbm_file::Encoding::Utf8 {
                start += sample.iter().take_while(|b| **b & 0xc0 == 0x80).count() as u64;
            }
            let mut end = start;
            let mut text = String::new();
            for line in Lines::new(&self.source, start) {
                let c = line?;
                text.push_str(&c.text);
                end = c.end;
                if end - start >= budget.min(PAGE_LIMIT) {
                    break;
                }
            }
            warning =
                Some("This position is not indexed yet; showing a bounded text window".into());
            blocks.push(gbm_render::render(start, end, 0, &text, 2, ""));
        }
        let start = blocks.first().map(|b| b.start).unwrap_or(self.source.bom);
        let end = blocks.last().map(|b| b.end).unwrap_or(self.source.size());
        if self.changed() {
            return Err(io::Error::other("Source changed during rendering"));
        }
        Ok(RenderWindow {
            start,
            end,
            blocks,
            request_version: version,
            warning,
        })
    }
    pub fn start_search(&self, query: String, sensitive: bool) -> io::Result<String> {
        let _guard = self.search_gate.lock().unwrap();
        if self.closed.load(Ordering::Relaxed) {
            return Err(io::Error::other("Document closed"));
        }
        if query.is_empty() || query.len() > 4096 {
            return Err(io::Error::other(
                "Search text must contain 1 to 4096 UTF-8 bytes",
            ));
        }
        self.cancel_search(None);
        // Join cancelled scans before starting another, bounding concurrent I/O and memory.
        self.reap(true);
        self.searches.lock().unwrap().clear();
        let id = format!("s{}", self.serial.fetch_add(1, Ordering::Relaxed));
        let job = SearchJob::new(self.source.size());
        self.searches
            .lock()
            .unwrap()
            .insert(id.clone(), job.clone());
        let source = self.source.clone();
        let handle = thread::Builder::new()
            .name("gbm-search".into())
            .spawn(move || {
                if let Err(e) = job.run(&source, &query, sensitive) {
                    let mut s = job.status.lock().unwrap();
                    s.error = Some(e.to_string());
                    s.complete = true;
                }
            })?;
        self.workers.lock().unwrap().push(handle);
        Ok(id)
    }
    pub fn search_results(
        &self,
        id: &str,
        start: usize,
        limit: usize,
    ) -> io::Result<(SearchStatus, Vec<SearchMatch>)> {
        let jobs = self.searches.lock().unwrap();
        let job = jobs
            .get(id)
            .ok_or_else(|| io::Error::other("Search expired"))?;
        let status = job.status.lock().unwrap().clone();
        let results = job
            .results
            .lock()
            .unwrap()
            .iter()
            .skip(start)
            .take(limit.min(200))
            .cloned()
            .collect();
        Ok((status, results))
    }
    pub fn cancel_search(&self, id: Option<&str>) {
        for (key, job) in self.searches.lock().unwrap().iter() {
            if id.is_none() || id == Some(key) {
                job.cancel.store(true, Ordering::Relaxed);
            }
        }
    }
    fn reap(&self, search_only: bool) {
        let mut workers = self.workers.lock().unwrap();
        let mut remaining = Vec::new();
        for worker in workers.drain(..) {
            if worker.is_finished() || (search_only && worker.thread().name() == Some("gbm-search"))
            {
                let _ = worker.join();
            } else {
                remaining.push(worker);
            }
        }
        *workers = remaining;
    }
    pub fn shutdown(&self) {
        if self.closed.swap(true, Ordering::Relaxed) {
            return;
        }
        let _guard = self.search_gate.lock().unwrap();
        self.index.cancel.store(true, Ordering::Relaxed);
        self.cancel_search(None);
        for worker in self.workers.lock().unwrap().drain(..) {
            let _ = worker.join();
        }
        self.searches.lock().unwrap().clear();
    }
    pub fn image(&self, relative: &str) -> io::Result<LocalImage> {
        if relative.contains(':') || relative.starts_with(['/', '\\']) || relative.contains('\0') {
            return Err(io::Error::other("Only relative local images are allowed"));
        }
        let root = self
            .source
            .path
            .parent()
            .ok_or_else(|| io::Error::other("No document directory"))?
            .canonicalize()?;
        let path = root.join(relative).canonicalize()?;
        if !path.starts_with(&root) {
            return Err(io::Error::other(
                "Image must be inside the document directory",
            ));
        }
        let extension = path
            .extension()
            .unwrap_or_default()
            .to_string_lossy()
            .to_ascii_lowercase();
        if !["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"].contains(&extension.as_str()) {
            return Err(io::Error::other("Unsupported image format"));
        }
        let meta = path.metadata()?;
        if !meta.is_file() || meta.len() > 16 * 1024 * 1024 {
            return Err(io::Error::other("Image exceeds the 16 MiB resource budget"));
        }
        use std::io::Read;
        let mut result = Vec::new();
        std::fs::File::open(path)?
            .take(16 * 1024 * 1024 + 1)
            .read_to_end(&mut result)?;
        if result.len() > 16 * 1024 * 1024 {
            return Err(io::Error::other("Image grew beyond resource budget"));
        }
        let dimensions =
            imagesize::blob_size(&result).map_err(|e| io::Error::other(e.to_string()))?;
        if dimensions.width.saturating_mul(dimensions.height) > 8_000_000 {
            return Err(io::Error::other(
                "Decoded image exceeds the 8 megapixel resource budget",
            ));
        }
        Ok(LocalImage {
            bytes: result,
            width: dimensions.width,
            height: dimensions.height,
        })
    }
}
impl Drop for Document {
    fn drop(&mut self) {
        self.shutdown();
    }
}

pub struct Engine {
    pub cache_root: PathBuf,
    documents: Mutex<HashMap<String, Arc<Document>>>,
    serial: AtomicU64,
}
impl Engine {
    pub fn new(cache_root: PathBuf) -> io::Result<Self> {
        std::fs::create_dir_all(&cache_root)?;
        Ok(Self {
            cache_root,
            documents: Mutex::new(HashMap::new()),
            serial: AtomicU64::new(1),
        })
    }
    pub fn open(&self, path: &Path) -> io::Result<DocumentInfo> {
        // One active document avoids competing index writers and bounds background work.
        let old: Vec<_> = self
            .documents
            .lock()
            .unwrap()
            .drain()
            .map(|(_, d)| d)
            .collect();
        for d in old {
            d.shutdown();
        }
        let id = format!("d{}", self.serial.fetch_add(1, Ordering::Relaxed));
        let doc = Document::open(path, &self.cache_root, id.clone())?;
        let info = doc.info.clone();
        self.documents.lock().unwrap().insert(id, doc);
        Ok(info)
    }
    pub fn get(&self, id: &str) -> io::Result<Arc<Document>> {
        self.documents
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or_else(|| io::Error::other("Document closed"))
    }
    pub fn close(&self, id: &str) {
        let doc = self.documents.lock().unwrap().remove(id);
        if let Some(d) = doc {
            d.shutdown();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn opening_first_screen_does_not_wait_for_index() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("doc.md");
        std::fs::write(&p, format!("# Hi\n\n{}", "paragraph\n\n".repeat(100000))).unwrap();
        let engine = Engine::new(dir.path().join("cache")).unwrap();
        let info = engine.open(&p).unwrap();
        let doc = engine.get(&info.id).unwrap();
        let w = doc.render_window(0, 256 * 1024, 42).unwrap();
        assert_eq!(w.request_version, 42);
        assert!(w.blocks[0].html.contains(">Hi</h1>"));
        assert!(w.end < info.size);
        engine.close(&info.id);
    }
    #[test]
    fn traversal_and_file_changes_are_detected() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("doc.md");
        std::fs::write(&p, "hello").unwrap();
        let engine = Engine::new(dir.path().join("cache")).unwrap();
        let info = engine.open(&p).unwrap();
        let doc = engine.get(&info.id).unwrap();
        assert!(doc.image("../outside.png").is_err());
        std::fs::write(&p, "changed document").unwrap();
        assert!(doc.changed());
        assert!(doc.render_window(0, 32768, 0).is_err());
        engine.close(&info.id);
    }
}
