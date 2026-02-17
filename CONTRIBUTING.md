# Contributing to Agent Reach

## Getting Started

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/agent-reach.git
   cd agent-reach
   ```
3. Create a feature branch:
   ```bash
   git checkout -b feature/your-feature
   ```

## Repository Structure

```
openclaw/          # OpenClaw plugin (TypeScript)
web/               # Dashboard (reach.agent-id.ai)
crates/            # Core library (Rust, future)
cli/               # Standalone CLI (Rust, future)
docs/              # Documentation
NIP-DRAFT.md       # Nostr protocol specification
```

## Development

### OpenClaw Plugin

```bash
cd openclaw
npm install
npm run build
```

### Web Dashboard

```bash
cd web
npm install
npm run dev
```

### Rust (future)

```bash
cargo build --all
cargo test --all
```

## Pull Request Process

1. Create a feature branch from `main`
2. Make your changes
3. Update documentation if needed
4. Open a Pull Request

### PR Guidelines

- Keep PRs focused and atomic
- Write clear commit messages
- Reference related issues
- Update docs for API changes

## Protocol

Agent Reach uses Nostr with two event kinds:
- **kind 31990** — Service Card (capabilities, protocols)
- **kind 31991** — Heartbeat (online status)

Labels use the `agent-reach` namespace (NIP-32). See [NIP-DRAFT.md](./NIP-DRAFT.md) for the full spec.

## License

By contributing, you agree that your contributions will be licensed under MIT.
