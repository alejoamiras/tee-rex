# Contributing to TEE-Rex

## Prerequisites

- [Bun](https://bun.sh/) v1.3+
- [OpenSSL](https://www.openssl.org/) (for attestation tests)
- An [Aztec](https://aztec.network/) local sandbox (for e2e tests)

## Setup

```sh
git clone https://github.com/alejoamiras/tee-rex.git
cd tee-rex
bun install
```

## Development Workflow

1. Create a feature branch from `main`:
   ```sh
   git checkout -b feat/your-feature main
   ```

2. Make your changes and validate:
   ```sh
   bun run test          # lint + typecheck + unit tests
   bun run lint:fix      # auto-fix formatting issues
   ```

3. Commit using [conventional commits](https://www.conventionalcommits.org/):
   ```sh
   git commit -m "feat: add widget support"
   ```
   Commitlint enforces the format via a pre-commit hook.

4. Push and create a PR:
   ```sh
   git push -u origin feat/your-feature
   gh pr create
   ```

## Project Structure

```
packages/
  sdk/       TypeScript SDK (@alejoamiras/tee-rex)
  server/    Express proving server
  app/       Vite frontend demo
infra/       Deploy scripts, IAM policies, CloudFront config
docs/        Architecture, CI pipeline reference
```

## Testing

| Command | Scope |
|---------|-------|
| `bun run test` | Lint + typecheck + all unit tests |
| `bun run test:unit` | Unit tests only |
| `bun run test:e2e` | E2E tests (requires local Aztec sandbox + server) |
| `bun run test:e2e:nextnet` | Nextnet smoke test (requires internet) |
| `bun run test:all` | Everything (unit + e2e) |

Unit tests live alongside source code (`src/*.test.ts`). E2e tests live in each package's `e2e/` directory.

## Code Style

- **Biome** handles linting and formatting (replaces ESLint + Prettier)
- **No `console.log`** — use structured logging via LogTape
- **Strict TypeScript** — no `any` without justification
- Run `bun run lint:fix` to auto-format before committing

## CI

PRs trigger automated checks per package (`sdk.yml`, `app.yml`, `server.yml`). The `infra.yml` workflow runs deploy + e2e tests when the `test-infra` label is added.

See [docs/ci-pipeline.md](docs/ci-pipeline.md) for the full CI reference.
