use pulldown_cmark::{html, BrokenLink, CowStr, Event, Options, Parser, Tag, TagEnd};

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
    let callback = |link: BrokenLink| {
        resolve(&normalize_label(&link.reference))
            .map(|(url, title)| (CowStr::from(url), CowStr::from(title)))
    };
    let parser = Parser::new_with_broken_link_callback(text, options, Some(callback));
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
                escape(&tex)
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
                CowStr::Borrowed("#")
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
}
