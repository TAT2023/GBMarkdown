use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RenderBlock {
    pub start: u64,
    pub end: u64,
    pub html: String,
    pub mode: String,
    pub line: u64,
}
pub fn render(
    start: u64,
    end: u64,
    line: u64,
    text: &str,
    mode: u8,
    language: &str,
) -> RenderBlock {
    render_with_references(start, end, line, text, mode, language, |_| None)
}
pub fn render_with_references(
    start: u64,
    end: u64,
    line: u64,
    text: &str,
    mode: u8,
    language: &str,
    resolve: impl FnMut(&str) -> Option<(String, String)>,
) -> RenderBlock {
    render_encoded(start, end, line, text, mode, language, false, resolve)
}
#[allow(clippy::too_many_arguments)]
pub fn render_encoded(
    start: u64,
    end: u64,
    line: u64,
    text: &str,
    mode: u8,
    language: &str,
    utf16: bool,
    resolve: impl FnMut(&str) -> Option<(String, String)>,
) -> RenderBlock {
    let (html, kind) = match mode {
        1 | 3 => (
            format!(
                "<pre><code class=\"language-{}\">{}</code></pre>",
                gbm_parser::escape(language),
                gbm_parser::escape(if mode == 3 {
                    let end = text.trim_end_matches(['\r', '\n']);
                    &text[..end.rfind('\n').map(|n| n + 1).unwrap_or(0)]
                } else {
                    text
                })
            ),
            "code",
        ),
        2 => (
            format!(
                "<pre class=\"plain-fragment\">{}</pre>",
                gbm_parser::escape(text)
            ),
            "compatibility",
        ),
        _ => {
            let h = gbm_parser::markdown_with_context(text, start, utf16, resolve);
            if h.len() > 2 * 1024 * 1024 || h.matches('<').count() > 12000 {
                (
                    format!(
                        "<pre class=\"plain-fragment\">{}</pre>",
                        gbm_parser::escape(text)
                    ),
                    "compatibility",
                )
            } else {
                (h, "markdown")
            }
        }
    };
    RenderBlock {
        start,
        end,
        line,
        html,
        mode: kind.into(),
    }
}
