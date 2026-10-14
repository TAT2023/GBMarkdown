# Copy Sources

Inline math $E = mc^2$ and a literal `$not_math$`.

```rust
fn main() {
    let text = "中文 😀 <tag> & $literal$";
    println!("{}", text);
}
```

$$
\begin{aligned}
\phi(t) &= \sin(2\pi t/P) \\
y &= \frac{a}{b}
\end{aligned}
$$

Unknown language keeps whitespace:

```unregistered
  leading spaces

	Tabbed line <&>
```

Invalid math still has a source: $\unknowncommand{中文}$.

## Navigation Target

Target paragraph.

