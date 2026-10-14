use pulldown_cmark::{html, BrokenLink, CowStr, Event, Options, Parser, Tag, TagEnd};
use std::{borrow::Cow, ops::Range};

// Math must be opaque to Markdown's block pass (notably Setext headings).
// Keep byte lengths unchanged so all source positions still refer to the file.
fn protect_display_math(text: &str, options: Options) -> (Cow<'_, str>, Vec<Range<usize>>) {
    if !text.contains("$$") {
        return (Cow::Borrowed(text), Vec::new());
    }
    let excluded: Vec<_> = Parser::new_ext(text, options)
        .into_offset_iter()
        .filter_map(|(event, range)| match event {
            Event::Start(Tag::CodeBlock(_)) | Event::Code(_) | Event::Html(_) => Some(range),
            _ => None,
        })
        .collect();
    let mut blocks = Vec::new();
    let mut opening = None;
    let mut offset = 0;
    let mut excluded_index = 0;
    for line in text.split_inclusive('\n') {
        let content = line.trim_end_matches(['\r', '\n']);
        let indent = content.len() - content.trim_start_matches(' ').len();
        if indent <= 3 && content[indent..].trim_end_matches([' ', '\t']) == "$$" {
            let start = offset + indent;
            if let Some(begin) = opening.take() {
                blocks.push(begin..start + 2);
            } else {
                while excluded_index < excluded.len() && excluded[excluded_index].end <= start {
                    excluded_index += 1;
                }
                if !excluded
                    .get(excluded_index)
                    .is_some_and(|range| range.contains(&start))
                {
                    opening = Some(start);
                }
            }
        }
        offset += line.len();
    }
    if blocks.is_empty() {
        return (Cow::Borrowed(text), blocks);
    }
    let mut protected = text.as_bytes().to_vec();
    for range in &blocks {
        protected[range.start + 2..range.end - 2].fill(b' ');
        protected[range.start + 2] = b'x';
    }
    (Cow::Owned(String::from_utf8(protected).unwrap()), blocks)
}

pub fn escape(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => result.push_str("&amp;"),
            '<' => result.push_str("&lt;"),
            '>' => result.push_str("&gt;"),
            '"' => result.push_str("&quot;"),
            '\'' => result.push_str("&#39;"),
            _ => result.push(c),
        }
    }
    result
}
pub fn allowed_link(url: &str) -> bool {
    let s = url.trim().to_ascii_lowercase();
    s.starts_with("https://")
        || s.starts_with("http://")
        || s.starts_with("mailto:")
        || s.starts_with('#')
}
pub fn local_image(url: &str) -> bool {
    !url.contains(':') && !url.starts_with('/') && !url.starts_with('\\') && !url.contains('\0')
}
pub fn markdown(text: &str) -> String {
    markdown_with_references(text, 0, |_| None)
}
pub fn heading_slug(markdown: &str) -> String {
    let mut text = String::new();
    let mut heading = false;
    for event in Parser::new_ext(
        markdown,
        Options::ENABLE_STRIKETHROUGH | Options::ENABLE_MATH,
    ) {
        match event {
            Event::Start(Tag::Heading { .. }) => heading = true,
            Event::End(TagEnd::Heading(_)) => break,
            Event::Text(s) | Event::Code(s) | Event::InlineMath(s) if heading => text.push_str(&s),
            Event::SoftBreak | Event::HardBreak if heading => text.push(' '),
            _ => {}
        }
    }
    text.to_lowercase()
        .chars()
        .filter_map(|c| {
            if c.is_whitespace() {
                Some('-')
            } else if c.is_alphanumeric() || matches!(c, '_' | '-' | '\u{0300}'..='\u{036f}') {
                Some(c)
            } else {
                None
            }
        })
        .collect()
}
pub fn reference_definitions(text: &str) -> Vec<(String, String, String)> {
    let parser = Parser::new(text);
    parser
        .reference_definitions()
        .iter()
        .map(|(label, def)| {
            (
                normalize_label(label),
                def.dest.to_string(),
                def.title
                    .as_ref()
                    .map(ToString::to_string)
                    .unwrap_or_default(),
            )
        })
        .collect()
}
pub fn normalize_label(label: &str) -> String {
    label
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}
pub fn markdown_with_references(
    text: &str,
    base: u64,
    mut resolve: impl FnMut(&str) -> Option<(String, String)>,
) -> String {
    markdown_with_context(text, base, false, &mut resolve)
}
pub fn markdown_with_context(
    text: &str,
    base: u64,
    utf16: bool,
    mut resolve: impl FnMut(&str) -> Option<(String, String)>,
) -> String {
    let mut positions = Vec::new();
    if utf16 {
        let mut raw = 0u64;
        for c in text.chars() {
            positions.extend(std::iter::repeat_n(raw, c.len_utf8()));
            raw += c.len_utf16() as u64 * 2;
        }
        positions.push(raw);
    }
    let source_offset = |position: usize| {
        base + if utf16 {
            positions.get(position).copied().unwrap_or(0)
        } else {
            position as u64
        }
    };
    let options = Options::ENABLE_TABLES
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_MATH;
    let (protected, math_blocks) = protect_display_math(text, options);
    let callback = |link: BrokenLink| {
        resolve(&normalize_label(&link.reference))
            .map(|(url, title)| (CowStr::from(url), CowStr::from(title)))
    };
    let parser = Parser::new_with_broken_link_callback(&protected, options, Some(callback));
    let events = parser.into_offset_iter().map(|(event, range)| match event {
        Event::Start(Tag::Heading { level, .. }) => Event::Html(
            format!(
                "<{} data-source-offset=\"{}\">",
                level,
                source_offset(range.start)
            )
            .into(),
        ),
        Event::End(TagEnd::Heading(level)) => Event::Html(format!("</{}>\n", level).into()),
        Event::Start(Tag::Paragraph) => {
            Event::Html(format!("<p data-source-offset=\"{}\">", source_offset(range.start)).into())
        }
        Event::End(TagEnd::Paragraph) => Event::Html("</p>\n".into()),
        Event::InlineMath(tex) => Event::Html(
            format!(
                "<span class=\"math-source\" data-math=\"inline\" data-source-offset=\"{}\">{}</span>",
                source_offset(range.start),
                escape(&tex)
            )
            .into(),
        ),
        Event::DisplayMath(tex) => Event::Html(
            format!(
                "<span class=\"math-source math-display\" data-math=\"display\" data-source-offset=\"{}\">{}</span>",
                source_offset(range.start),
                escape(
                    math_blocks
                        .binary_search_by_key(&range.start, |block| block.start)
                        .ok()
                        .map(|index| &text[math_blocks[index].start + 2..math_blocks[index].end - 2])
                        .unwrap_or(&tex)
                )
            )
            .into(),
        ),
        Event::Html(s) | Event::InlineHtml(s) => Event::Text(s),
        Event::Start(Tag::Link {
            link_type,
            dest_url,
            title,
            id,
        }) => {
            let dest = if allowed_link(&dest_url) {
                dest_url
            } else {
                CowStr::Borrowed("")
            };
            Event::Start(Tag::Link {
                link_type,
                dest_url: dest,
                title,
                id,
            })
        }
        Event::Start(Tag::Image {
            dest_url, title, ..
        }) => {
            let attrs = if local_image(&dest_url) {
                format!(
                    "<span class=\"image-slot\" data-local-image=\"{}\" data-title=\"{}\">",
                    escape(&dest_url),
                    escape(&title)
                )
            } else {
                "<span class=\"image-slot image-blocked\">".into()
            };
            Event::Html(attrs.into())
        }
        Event::End(TagEnd::Image) => Event::Html("</span>".into()),
        other => other,
    });
    let mut output = String::new();
    html::push_html(&mut output, events);
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn raw_html_and_dangerous_urls_are_inert() {
        let h = markdown(
            "<script>alert(1)</script>\n\n[x](javascript:alert) ![photo](https://evil.test/x.png)",
        );
        assert!(!h.contains("<script>"));
        assert!(!h.contains("href=\"javascript:"));
        assert!(!h.contains("<img"));
    }
    #[test]
    fn gfm_and_relative_images() {
        let h = markdown("| A | B |\n|---|---|\n| 1 | 2 |\n\n- [x] task\n\n![cat](images/cat.png)");
        assert!(h.contains("<table>"));
        assert!(h.contains("checked"));
        assert!(h.contains("data-local-image=\"images/cat.png\""));
    }
    #[test]
    fn global_reference_callback() {
        let h = markdown_with_references("[link][remote]", 40, |label| {
            if label == "remote" {
                Some(("https://example.com".into(), "title".into()))
            } else {
                None
            }
        });
        assert!(h.contains("href=\"https://example.com\""));
        assert!(h.contains("data-source-offset=\"40\""));
    }
    #[test]
    fn math_preserves_tex_and_excludes_literal_code() {
        let h = markdown_with_references(
            "Inline $x^2 < y$ and `$literal$`.\n\n$$\n\\frac{a}{b}\n$$\n\n```tex\n$code$\n```\n\n\\$escaped\\$",
            100,
            |_| None,
        );
        assert_eq!(h.matches("data-math=").count(), 2);
        assert!(h.contains("data-math=\"inline\" data-source-offset=\"107\">x^2 &lt; y"));
        assert!(h.contains("data-math=\"display\""));
        assert!(h.contains("\\frac{a}{b}"));
        assert!(h.contains("<code>$literal$</code>"));
        assert!(h.contains("$code$"));
        assert!(h.contains("$escaped$"));
    }
    #[test]
    fn math_html_is_escaped_and_offsets_follow_utf16() {
        let h = markdown_with_context("中文 $<script>alert(1)</script>$", 2, true, |_| None);
        assert!(!h.contains("<script>"));
        assert!(h.contains("&lt;script&gt;"));
        assert!(h.contains("data-math=\"inline\" data-source-offset=\"8\""));
    }
    #[test]
    fn multiline_fourier_math_with_setext_like_equals() {
        let text = "Fourier:\n\n$$\n\\phi(\\Delta t_i)\n=\n[\n\\sin(2\\pi\\Delta t_i/P_1),\n\\cos(2\\pi\\Delta t_i/P_1),\n\\dots,\n\\log(1+\\Delta t_i)\n]\n$$\n$$\nP_k=2^{k-1}, \\quad k=1,\\dots,K\n$$\n\nDefault $K=16$.";
        let h = markdown(text);
        assert_eq!(h.matches("data-math=\"display\"").count(), 2, "{h}");
        assert!(h.contains("\\phi(\\Delta t_i)\n=\n["), "{h}");
        assert!(!h.contains("<h1"), "{h}");
        assert_eq!(h.matches("data-math=\"inline\"").count(), 1);
    }
    #[test]
    fn display_math_is_opaque_to_markdown_and_keeps_source_positions() {
        let text =
            "中文\r\n\r\n$$\r\na\r\n\r\n=\r\n# not a heading\r\n<script>\r\n$$\r\n\r\n# After\r\n";
        for utf16 in [false, true] {
            let h = markdown_with_context(text, 10, utf16, |_| None);
            let offset = if utf16 { 22 } else { 20 };
            assert!(
                h.contains(&format!(
                    "data-math=\"display\" data-source-offset=\"{offset}\""
                )),
                "{h}"
            );
            assert!(
                h.contains("a\r\n\r\n=\r\n# not a heading\r\n&lt;script&gt;"),
                "{h}"
            );
            assert_eq!(h.matches("<h1").count(), 1, "{h}");
            assert!(h.contains(">After</h1>"));
            assert!(!h.contains("<script>"));
        }
    }
    #[test]
    fn standalone_dollars_in_code_and_html_stay_literal() {
        let h = markdown("```tex\n$$\na\n=\n$$\n```\n\n    $$\n    a\n    $$\n\n<!--\n$$\na\n$$\n-->\n\n`code\n$$\na\n$$\n`\n\n\t$$\na\n\n# After\n\n$$\nb\n=\nc\n$$");
        assert_eq!(h.matches("data-math=\"display\"").count(), 1, "{h}");
        assert!(h.contains("b\n=\nc"));
        assert!(h.contains("<code class=\"language-tex\">$$"));
        assert!(h.contains(">After</h1>"));
    }
    #[test]
    fn unclosed_math_does_not_swallow_following_markdown() {
        let h = markdown("$$\na\n\n# After\n\n[link](https://example.com)");
        assert!(!h.contains("data-math=\"display\""));
        assert!(h.contains(">After</h1>"));
        assert!(h.contains("href=\"https://example.com\""));
    }
}
