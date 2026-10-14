use gbm_core::Engine;
use std::{
    io::Write,
    time::{Duration, Instant},
};
fn wait(doc: &gbm_core::Document) {
    let start = Instant::now();
    while !doc.status().complete {
        assert!(start.elapsed() < Duration::from_secs(15));
        assert!(doc.status().error.is_none(), "{:?}", doc.status());
        std::thread::sleep(Duration::from_millis(5));
    }
}
fn normalize(mut html: String) -> String {
    while let Some(start) = html.find(" data-source-offset=\"") {
        let tail = &html[start + 21..];
        let end = tail.find('"').unwrap();
        html.replace_range(start..start + 21 + end + 1, "");
    }
    html
}

#[test]
fn pagination_matches_full_parse_for_common_blocks() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("mixed.md");
    let chapter="# Heading 中文\n\nA **bold** paragraph and `code`, with $x^2$ and \\(y^2\\) math.\n\n$$\n\\frac{a}{b}\n=\na\n\n+ b\n$$\n$$\nc = d\n$$\n\n\\[\nx\n=\ny\n\n+ z\n\\]\n\n- first\n- second\n  - nested\n\n> quoted text\n\n```rust\nfn main() {}\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n";
    let text = chapter.repeat(1600);
    std::fs::write(&path, &text).unwrap();
    let engine = Engine::new(dir.path().join("cache")).unwrap();
    let info = engine.open(&path).unwrap();
    let doc = engine.get(&info.id).unwrap();
    wait(&doc);
    let mut html = String::new();
    for n in 0..doc.status().pages {
        let page = doc.index.page(n).unwrap();
        let (text, _) = doc.source.text(page.start, page.end).unwrap();
        assert_eq!(page.mode, 0);
        html.push_str(&gbm_parser::markdown_with_references(
            &text,
            page.start,
            |_| None,
        ));
    }
    assert_eq!(normalize(html), normalize(gbm_parser::markdown(&text)));
    engine.close(&info.id);
}
#[test]
fn definitions_after_the_viewport_resolve_from_disk() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("references.md");
    std::fs::write(&path,format!("# References\n\n[a][Destination]\n\n{}\n[destination]: https://example.com/ \"Global\"\n", "ordinary paragraph\n\n".repeat(12000))).unwrap();
    let engine = Engine::new(dir.path().join("cache")).unwrap();
    let info = engine.open(&path).unwrap();
    let doc = engine.get(&info.id).unwrap();
    wait(&doc);
    assert!(doc.render_window(0, 32768, 0).unwrap().blocks[0]
        .html
        .contains("href=\"https://example.com/\""));
    engine.close(&info.id);
}
#[test]
fn long_lines_and_dense_headings_keep_windows_bounded() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("long.md");
    let mut file = std::fs::File::create(&path).unwrap();
    let chunk = "中文😀 Long line ".repeat(65536);
    for _ in 0..24 {
        file.write_all(chunk.as_bytes()).unwrap();
    }
    drop(file);
    let engine = Engine::new(dir.path().join("cache")).unwrap();
    let info = engine.open(&path).unwrap();
    let doc = engine.get(&info.id).unwrap();
    wait(&doc);
    for fraction in [0, 1, 5, 9] {
        let window = doc
            .render_window(info.size * fraction / 10, 128 * 1024, fraction)
            .unwrap();
        assert!(window.end - window.start <= 256 * 1024);
        assert!(window.blocks.iter().all(|b| b.html.len() < 2 * 1024 * 1024));
    }
    engine.close(&info.id);
    std::fs::write(&path, "# tiny\n\n".repeat(100000)).unwrap();
    let info = engine.open(&path).unwrap();
    let doc = engine.get(&info.id).unwrap();
    wait(&doc);
    assert_eq!(doc.status().headings, 100000);
    assert_eq!(doc.outline(99990, 200).unwrap().len(), 10);
    assert!(
        doc.index
            .directory
            .join("headings.bin")
            .metadata()
            .unwrap()
            .len()
            < 2 * 1024 * 1024
    );
    engine.close(&info.id);
}
#[test]
fn switching_closes_old_scans_and_old_handles() {
    let dir = tempfile::tempdir().unwrap();
    let a = dir.path().join("a.md");
    let b = dir.path().join("b.md");
    std::fs::write(&a, "text search\n\n".repeat(100000)).unwrap();
    std::fs::write(&b, "# next\n").unwrap();
    let engine = Engine::new(dir.path().join("cache")).unwrap();
    let old = engine.open(&a).unwrap();
    let doc = engine.get(&old.id).unwrap();
    let sid = doc.start_search("search".into(), false).unwrap();
    let new = engine.open(&b).unwrap();
    assert!(engine.get(&old.id).is_err());
    assert!(doc.search_results(&sid, 0, 200).is_err());
    engine.close(&new.id);
}

#[test]
fn local_images_validate_headers_and_decoded_budget() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("image.md");
    std::fs::write(&path, "![local](icon.png)").unwrap();
    let png = include_bytes!("../../../src-tauri/icons/32x32.png");
    std::fs::write(dir.path().join("icon.png"), png).unwrap();
    let engine = Engine::new(dir.path().join("cache")).unwrap();
    let info = engine.open(&path).unwrap();
    let doc = engine.get(&info.id).unwrap();
    let image = doc.image("icon.png").unwrap();
    assert_eq!((image.width, image.height), (32, 32));
    let mut large = png.to_vec();
    large[16..20].copy_from_slice(&100000u32.to_be_bytes());
    large[20..24].copy_from_slice(&100000u32.to_be_bytes());
    std::fs::write(dir.path().join("oversized.png"), large).unwrap();
    assert!(doc.image("oversized.png").is_err());
    assert!(doc.image("https://example.com/image.png").is_err());
    engine.close(&info.id);
}

#[test]
fn heading_after_a_giant_fence_is_not_rendered_as_code() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("giant.md");
    let text = format!(
        "```rust\n{}\n```\n\n# After\n",
        "let x = 42;\n".repeat(50000)
    );
    std::fs::write(&path, &text).unwrap();
    let engine = Engine::new(dir.path().join("cache")).unwrap();
    let info = engine.open(&path).unwrap();
    let doc = engine.get(&info.id).unwrap();
    wait(&doc);
    let window = doc
        .render_window(text.find("# After").unwrap() as u64, 65536, 1)
        .unwrap();
    assert!(window.blocks.iter().any(|b| b.html.contains(">After</h1>")));
    assert_eq!(window.blocks.last().unwrap().mode, "markdown");
    engine.close(&info.id);
}

#[test]
fn math_survives_pagination_and_giant_math_recovers_after_closing() {
    for (open, close) in [("$$", "$$"), (r"\[", r"\]")] {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("math.md");
        let text = format!(
            "{}\n\n{open}\n{}\\frac{{a}}{{b}}\n{close}\n\n# After\n",
            "paragraph\n\n".repeat(2960),
            "x +\n".repeat(200)
        );
        std::fs::write(&path, &text).unwrap();
        let engine = Engine::new(dir.path().join("cache")).unwrap();
        let info = engine.open(&path).unwrap();
        let doc = engine.get(&info.id).unwrap();
        wait(&doc);
        let formula = text.find(open).unwrap() as u64;
        let window = doc.render_window(formula, 65536, 1).unwrap();
        let html: String = window.blocks.iter().map(|b| b.html.as_str()).collect();
        assert_eq!(html.matches("data-math=\"display\"").count(), 1);
        assert!(html.contains("\\frac{a}{b}"));
        engine.close(&info.id);

        let text = format!(
            "{open}\n{}{close}\n\n# After\n",
            "x +\n# not a heading\n$$ inside bracket math\n".repeat(10000)
        );
        std::fs::write(&path, &text).unwrap();
        let info = engine.open(&path).unwrap();
        let doc = engine.get(&info.id).unwrap();
        wait(&doc);
        for n in 0..doc.status().pages - 1 {
            let page = doc.index.page(n).unwrap();
            assert_eq!(page.mode, 2);
            assert!(page.end - page.start <= 192 * 1024);
        }
        let last = doc
            .render_window(text.find("# After").unwrap() as u64, 65536, 2)
            .unwrap();
        assert!(last.blocks.iter().any(|b| b.html.contains(">After</h1>")));
        assert_eq!(doc.outline(0, 100).unwrap().len(), 1);
        engine.close(&info.id);
    }
}
