# LaTeX Delimiters

Inline \(E = mc^2\), \(\frac{a}{b}\), and existing $x^2$.

Wrapped inline \(a +
b\).

\[
\phi(\Delta t_i)
=
\begin{aligned}
a &= b \\
c &= d
\end{aligned}
\]

Same line display: \[\sum_{k=1}^n k\] and \(\alpha + \beta\).

| Name | Formula |
| --- | --- |
| Root | \(\sqrt{x}\) |

## Literals

Code: `\(not_math\)` and `\[not_math\]`.

Escaped: \\(escaped\\) and \\[escaped\\].

```tex
\(code\)
\[code\]
```

## Recovery

Invalid: \(\unknowncommand{x}\).

Unclosed inline: \(unclosed

## After Unclosed

Valid: \(\gamma\).
