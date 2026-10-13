use gbm_core::Engine;
use std::{
    path::PathBuf,
    time::{Duration, Instant},
};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = PathBuf::from(
        std::env::args()
            .nth(1)
            .ok_or("usage: benchmark <file.md>")?,
    );
    let root = std::env::temp_dir().join("gbmarkdown-benchmark-cache");
    let engine = Engine::new(root)?;
    let begin = Instant::now();
    let info = engine.open(&path)?;
    let doc = engine.get(&info.id)?;
    let first = doc.render_window(0, 128 * 1024, 1)?;
    let first_ms = begin.elapsed().as_secs_f64() * 1000.;
    let early = doc.render_window(info.size * 9 / 10, 128 * 1024, 2)?;
    while !doc.status().complete && doc.status().error.is_none() {
        std::thread::sleep(Duration::from_millis(50));
    }
    if let Some(e) = doc.status().error {
        return Err(e.into());
    }
    let index_seconds = begin.elapsed().as_secs_f64();
    let mut timings = Vec::new();
    let mut max_html = 0;
    for i in 0..100 {
        let offset = info.size * ((i * 37) % 100) / 100;
        let t = Instant::now();
        let w = doc.render_window(offset, 128 * 1024, i)?;
        timings.push(t.elapsed().as_secs_f64() * 1000.);
        max_html = max_html.max(w.blocks.iter().map(|b| b.html.len()).sum::<usize>());
    }
    timings.sort_by(f64::total_cmp);
    let t = Instant::now();
    let sid = doc.start_search("NeedleGBM".into(), true)?;
    loop {
        let (s, _) = doc.search_results(&sid, 0, 1)?;
        if s.complete {
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let (search, _) = doc.search_results(&sid, 0, 1)?;
    let result = serde_json::json!({"bytes":info.size,"first_screen_ms":first_ms,"first_window_bytes":first.end-first.start,"early_jump_bytes":early.end-early.start,"index_seconds":index_seconds,"index":doc.status(),"jump_p95_ms":timings[95],"max_html_bytes":max_html,"search_seconds":t.elapsed().as_secs_f64(),"search":search});
    println!("{}", serde_json::to_string_pretty(&result)?);
    engine.close(&info.id);
    Ok(())
}
