# Commits and pull requests

- Commit messages follow Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, `ci:`). commitlint checks them in the `commit-msg` hook and in CI.
- Hooks run format, lint, secrets, and typecheck. Fix what they report rather than skipping them with `--no-verify`.
- Keep pull requests small and fill in the template: why, what changed, verification evidence (test output, screenshots, or a recording), and every decision you made without asking.
