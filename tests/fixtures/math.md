# Formula Rendering

Inline energy $E = mc^2$, fraction $\frac{a}{b}$, and a comparison $x < y$.

## Display Equations

$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$

$$
\begin{aligned}
a^2 + b^2 &= c^2 \\
\sum_{k=1}^{n} k &= \frac{n(n+1)}{2}
\end{aligned}
$$

$$
\begin{bmatrix}
1 & 2 \\
3 & 4
\end{bmatrix}
$$

Fourier encoding, with an equals sign on its own line:

$$
\phi(\Delta t_i)
=
[
\sin(2\pi\Delta t_i/P_1),
\cos(2\pi\Delta t_i/P_1),
\dots,
\sin(2\pi\Delta t_i/P_K),
\cos(2\pi\Delta t_i/P_K),
\log(1+\Delta t_i)
]
$$
$$
P_k=2^{k-1}, \quad k=1,\dots,K
$$

Default $K=16$.

A table also contains math:

| Quantity | Formula |
| --- | --- |
| Area | $\pi r^2$ |
| Roots | $\sqrt{x}$ |

## Literal Text

Inline code stays literal: `$not_math$`. Escaped dollars stay literal: \$escaped\$.

```tex
$$
\frac{code}{literal}
$$
```

## Error Recovery

Invalid syntax preserves its source: $\unknowncommand{x}$.

Untrusted commands cannot open links: $\href{javascript:alert(1)}{click}$.

Remote resources stay blocked: $\includegraphics{https://example.com/formula.png}$.

HTML remains inert: $<script>alert(1)</script>$.

A valid formula after the invalid ones still renders: $\alpha + \beta$.
