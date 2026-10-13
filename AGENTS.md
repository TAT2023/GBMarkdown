# Branch Workflow

- Keep `main` and `dev` at the same commit. `dev` is a development starting point.
- Before development, fetch `origin` and fast-forward local `dev` to `origin/main`.
- Create a new feature or fix branch from `dev`; commit development on that branch.
- Merge approved changes into `main`. The Sync Dev workflow then fast-forwards remote `dev` to `main`.
- Do not force-push `dev` if it has diverged. Inspect and reconcile the commits first.
- Tag releases with annotated `vX.Y.Z` tags. `v0.1.0` identifies the original release commit `92e4b7e`.
