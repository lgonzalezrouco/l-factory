# AGENTS.md

A software factory that turns tickets into verified pull requests, written in TypeScript with Effect v4.

This project uses pnpm workspaces. Run `pnpm check` (format, lint, typecheck, secrets, test) before you call a task done. `pnpm typecheck` runs `tsc` from TypeScript 7, which is the native Go compiler (formerly tsgo), patched by `@effect/tsgo`. `tsc --version` prints `7.x+effect-tsgo`.

When the same mistake repeats, encode the fix as a type, lint rule, or test instead of adding prose here.

For Effect conventions, see [docs/EFFECT.md](docs/EFFECT.md).
For testing, see [docs/TESTING.md](docs/TESTING.md).
For commits and pull requests, see [docs/GIT.md](docs/GIT.md).
