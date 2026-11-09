# Commits and pull requests

- Commit messages follow Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, `ci:`). commitlint checks them in the `commit-msg` hook and in CI.
- Hooks run format, lint, secrets, and typecheck. Fix what they report rather than skipping them with `--no-verify`.
- Keep pull requests small. Write the body with these `##` sections in this order: Why, What changed, Scope, Tradeoffs, Blast Radius, and Verification. Drop a section that has nothing to say, but always keep Scope. Verification names each real run and its outcome.
