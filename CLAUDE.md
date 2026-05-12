# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`agent-auth` is a unified CLI for switching third-party auth/config across multiple coding agents (codex, claude, gemini). It manages provider registries under `~/.agent-auth/` and renders configuration into each agent's runtime files.

**Key Architecture:**
- **Dual implementation**: `agent-auth` (zsh entrypoint) and `agent-auth-node.js` (Node.js implementation with identical behavior)
- **Provider registry**: `~/.agent-auth/providers/<agent>/<provider_id>.json` stores provider configs
- **Runtime state**: `~/.agent-auth/state/<agent>.json` tracks active provider per agent
- **Agent renderers**: Each agent has a dedicated renderer that writes to its config files:
  - `codex` → `~/.codex/config.toml` + `~/.codex/auth.json`
  - `claude` → `~/.claude/settings.json` (env section)
  - `gemini` → `~/.gemini/.env`

**Session history**: `codex_sessions_list.mjs` provides session lookup from `~/.codex/sessions/rollout-*.jsonl` files, integrated as `agent-auth codex sessions` command.

## Development Commands

**Run the Node CLI directly** (for development/testing):
```bash
node ./agent-auth-node.js help
node ./agent-auth-node.js codex status
```

**Build binaries** (requires Bun 1.1+):
```bash
bun run build                  # all targets
bun run build:macos            # macOS x64 + arm64
bun run build:windows          # Windows x64
bun run build:macos:x64        # single target
```

Output: `dist/agent-auth-{macos-x64,macos-arm64,windows-x64.exe}`

**Install the zsh entrypoint**:
```bash
./install.sh                   # installs to ~/.local/bin/agent-auth
TARGET_DIR=/path ./install.sh  # custom install location
```

**Isolated testing** (avoids touching real config):
```bash
TMP_HOME=$(mktemp -d)
mkdir -p "$TMP_HOME/.codex"
printf '[tui]\nstatus_line = ["git-branch"]\n' > "$TMP_HOME/.codex/config.toml"
HOME="$TMP_HOME" node ./agent-auth-node.js codex add demo --url https://example.com/v1 --key sk-demo
```

Or use environment overrides:
```bash
AGENT_AUTH_DIR=/tmp/test-auth CODEX_DIR=/tmp/test-codex node ./agent-auth-node.js codex status
```

## Code Organization

- `agent-auth`: zsh CLI with `set -euo pipefail`, uses `snake_case` functions
- `agent-auth-node.js`: Node.js CommonJS implementation (uses `require()`)
- `scripts/build-binaries.mjs`: ESM build script for Bun compilation
- `codex_sessions_list.mjs`: ESM module for session history lookup, exported functions for reuse
- `.github/workflows/bun-build-artifacts.yml`: CI workflow that builds and publishes releases on `v*` tags

**Module style**:
- Keep `agent-auth-node.js` in CommonJS for compatibility
- Use ESM (`*.mjs`) for build tooling and standalone scripts
- 2-space indentation, `const` by default, small pure helper functions

## Testing

No automated test suite exists. Validate changes by running core flows manually:
- `list`, `status`, `add`, `use`, `update`, `delete`, `official`
- Always test with isolated `HOME` or override `AGENT_AUTH_DIR`/`CODEX_DIR`
- Use dummy keys; never rely on or modify real credentials

## Security

- Never log, print, or commit API keys
- Redact secrets in examples and debug output
- Preserve restrictive permissions for `~/.agent-auth/**` (0700-style intent)
- Provider IDs must match `^[A-Za-z0-9][A-Za-z0-9_-]*$`

## Release Process

- Tag with `v*` (e.g., `v1.2.0`) to trigger GitHub Actions workflow
- Workflow builds all platform binaries and publishes a GitHub Release
- Artifacts: `agent-auth-macos-x64`, `agent-auth-macos-arm64`, `agent-auth-windows-x64.exe`
