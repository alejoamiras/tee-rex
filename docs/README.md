# Documentation

| Document | Description |
|----------|-------------|
| [Architecture](./architecture.md) | System overview, proving flow, package structure, and Docker image strategy (Mermaid diagrams) |
| [How It Works](./how-it-works.md) | Detailed explanation of the attestation and proving protocol, Nitro Enclave properties, and SDK usage |
| [CI Pipeline](./ci-pipeline.md) | All GitHub Actions workflows, change detection, conditional deploys, and Docker caching strategy |
| [Nitro Deployment](./nitro-deployment.md) | Step-by-step guide for deploying the Nitro Enclave on EC2 |

## Development

| Document | Description |
|----------|-------------|
| [CLAUDE.md](../CLAUDE.md) | Full development roadmap, architectural decisions, and phase history |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Setup, workflow, testing, and code style guide |

## Audit Reports

The `audit/` folder contains a comprehensive codebase audit (60 findings across 10 categories):

| Document | Scope |
|----------|-------|
| [00 Master Plan](./audit/00-master-plan.md) | Audit methodology and approach |
| [01 SDK](./audit/01-sdk.md) | SDK package findings |
| [02 Server](./audit/02-server.md) | Server package findings |
| [03 App](./audit/03-app.md) | Frontend app findings |
| [04 CI/CD](./audit/04-ci-cd.md) | GitHub Actions workflows |
| [05 Infra & Docker](./audit/05-infra-docker.md) | Dockerfiles and deploy scripts |
| [06 Security](./audit/06-security.md) | Security review |
| [07 Testing](./audit/07-testing.md) | Test coverage and quality |
| [08 Docs & DX](./audit/08-docs-dx.md) | Documentation and developer experience |
| [09 Code Quality](./audit/09-code-quality.md) | Code quality and maintainability |
| [10 Summary](./audit/10-summary.md) | Prioritized summary of all findings |
