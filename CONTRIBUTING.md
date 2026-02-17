# Contributing to Agent Bridge

## Getting Started

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/agent-bridge.git
   cd agent-bridge
   ```
3. Create a feature branch:
   ```bash
   git checkout -b feature/your-feature
   ```

## Development

### Prerequisites

- Rust 1.70+ (stable)
- cargo

### Building

```bash
cargo build --all
```

### Testing

```bash
cargo test --all
```

### Code Quality

Before submitting, ensure:

```bash
# Format code
cargo fmt

# Check for warnings
cargo clippy --all-targets -- -D warnings

# Run tests
cargo test --all
```

## Pull Request Process

1. Create a feature branch from `main`
2. Make your changes
3. Add tests for new functionality
4. Update documentation if needed
5. Ensure CI passes
6. Open a Pull Request

### PR Guidelines

- Keep PRs focused and atomic
- Write clear commit messages
- Reference related issues
- Add tests for new features
- Update docs for API changes

## Code Style

- Follow Rust conventions
- Use `rustfmt` for formatting
- Document public APIs
- Write descriptive variable names
- Keep functions focused and small
- No wildcard imports

## Architecture

```
crates/
├── agent-reach/         # Core discovery library
└── agent-reach-derive/  # Derive macros for tag generation

docs/                        # Documentation
```

## License

By contributing, you agree that your contributions will be licensed under MIT.
