# Branch Workflow

- Keep `main` and `dev` at the same commit after integration. `dev` is a development starting point and the first merge target.
- Before development, fetch `origin` and fast-forward local `dev` to `origin/main`.
- Create a new feature or fix branch from `dev`; commit development on that branch.
- Merge approved feature, fix, or chore branches into `dev` with `git merge --no-ff <branch>` to preserve branch history.
- Merge `dev` into `main` with `git merge --no-ff dev`, then fast-forward local `dev` to `main` with `git merge --ff-only main` and push both branches.
- The Sync Dev workflow also fast-forwards remote `dev` to `main`. Fast-forward is only for synchronization; development and release merges must use `--no-ff`.
- Do not force-push `dev` if it has diverged. Inspect and reconcile the commits first.
- Tag releases with annotated `vX.Y.Z` tags. `v0.1.0` identifies the original release commit `92e4b7e`.
