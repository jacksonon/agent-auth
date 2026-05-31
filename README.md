# agent-auth

`agent-auth` is a unified CLI for switching third-party auth/config across multiple coding agents.

Current built-in renderers:
- `codex`
- `claude`
- `gemini`

The command model is standardized:

```bash
agent-auth <agent> <command> ...
```

Provider registry is stored under `~/.agent-auth/providers/<agent>/<provider_id>.json`, and runtime state is stored under `~/.agent-auth/state/<agent>.json`.

## Managed Runtime Targets

- `codex`: `~/.codex/config.toml` + `~/.codex/auth.json`
- `claude`: `~/.claude/settings.json`
- `gemini`: `~/.gemini/.env`

`agent-auth` keeps one renderer per agent, so adding another agent later only requires a new renderer branch and its runtime file mapping.

## Install

```bash
./install.sh
```

If `~/.local/bin` is not already in `PATH`:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Install to a custom target directory:

```bash
TARGET_DIR=/tmp/agent-auth-bin ./install.sh
```

## Global Commands

```bash
agent-auth help
agent-auth agents
agent-auth backup help
```

## Standard Commands

```bash
agent-auth <agent> help
agent-auth <agent> list
agent-auth <agent> status
agent-auth <agent> official
agent-auth <agent> use <provider_id>
agent-auth <agent> add <provider_id> --url <base_url> --key <api_key> [--name <display_name>] [--model <model>] [--env KEY=VALUE ...]
agent-auth <agent> update <provider_id> [--name <display_name>] [--url <base_url>] [--key <api_key>] [--model <model>] [--env KEY=VALUE ...] [--unset-env KEY ...]
agent-auth <agent> delete <provider_id>
```

Notes:
- `--url` and `--key` are the standard input fields for all built-in agents.
- `--env KEY=VALUE` can be repeated for agent-specific extensions.
- `--unset-env KEY` is available on `update` to remove a previously stored env override.
- `delete` removes the stored provider. If that provider is currently active, `agent-auth` falls back to `official` first so runtime state stays consistent.

## Backup And Restore

`agent-auth` can back up the local `~/.claude` and `~/.codex` directories, and it can also back up project-specific files such as `CLAUDE.md`, `AGENTS.md`, `.claude/`, and `.codex/`.

Backups are zipped and encrypted before they are copied into a GitHub repository. Use `AGENT_AUTH_BACKUP_PASSPHRASE` for non-interactive runs.

### Machine backup

```bash
AGENT_AUTH_BACKUP_PASSPHRASE='change-me' \
agent-auth backup machine \
  --repo yourname/agent-config-backup \
  --create-repo
```

This backs up the current machine's `~/.claude` and `~/.codex` content into `machine/<hostname>/`.

### Project backup

```bash
AGENT_AUTH_BACKUP_PASSPHRASE='change-me' \
agent-auth backup project \
  --repo yourname/agent-config-backup \
  --project-dir /path/to/project \
  --include CLAUDE.md \
  --include AGENTS.md \
  --include .claude \
  --include .codex
```

If `--include` is omitted, the default project backup set is `CLAUDE.md`, `AGENTS.md`, `.claude`, and `.codex`. Project snapshots are stored under `projects/<project-name>/`.

### Project restore

```bash
AGENT_AUTH_BACKUP_PASSPHRASE='change-me' \
agent-auth restore project \
  --repo yourname/agent-config-backup \
  --project-dir /path/to/project \
  --snapshot latest
```

Restore only part of a snapshot by repeating `--include`:

```bash
agent-auth restore project \
  --repo yourname/agent-config-backup \
  --project-dir /path/to/project \
  --include AGENTS.md
```

When restore overwrites existing files, the previous files are copied to `.agent-auth-restore-backup/<timestamp>/`.

### GitHub repo creation

If the backup repository does not exist yet, add `--create-repo`. The command creates a private repo through `gh` and then pushes the encrypted snapshot.

### Full backup usage

Prerequisites:

- `git` is required for cloning, committing, and pushing the backup repository.
- `zip` and `unzip` are required for archive creation and restore extraction.
- `openssl` is required for encryption and decryption.
- `gh` is required only when using `--create-repo` to create a missing GitHub repository automatically.
- Set `AGENT_AUTH_BACKUP_PASSPHRASE` for scripts and CI. In an interactive terminal, the command prompts for the passphrase if the env var is not set.

Command reference:

```bash
agent-auth backup help
agent-auth backup machine --repo <owner/repo> [--create-repo] [--message <text>]
agent-auth backup project --repo <owner/repo> [--project-dir <path>] [--project-name <name>] [--include <relative_path> ...] [--create-repo] [--message <text>]
agent-auth restore project --repo <owner/repo> [--project-dir <path>] [--project-name <name>] [--snapshot latest|<archive_name>] [--include <relative_path> ...]
```

Arguments:

- `--repo <owner/repo>` is required for GitHub backups and restores, for example `yourname/agent-config-backup`.
- `--create-repo` creates the GitHub repo when it is missing. Repos are created as private repos through `gh`.
- `--project-dir <path>` selects the project to back up or restore. It defaults to the current directory.
- `--project-name <name>` controls the backup folder under `projects/`. It defaults to the basename of `--project-dir`.
- `--include <relative_path>` can be repeated to back up or restore only selected project files or directories.
- `--snapshot latest` restores the newest project archive. You can also pass an exact archive name or a unique archive prefix.
- `--message <text>` customizes the git commit message for a backup.

Back up this machine:

```bash
AGENT_AUTH_BACKUP_PASSPHRASE='change-me' \
agent-auth backup machine \
  --repo yourname/agent-config-backup \
  --create-repo
```

The machine backup includes `~/.claude` and `~/.codex` when present, then stores the encrypted archive under `machine/<hostname>/`.

Back up the default project agent files:

```bash
AGENT_AUTH_BACKUP_PASSPHRASE='change-me' \
agent-auth backup project \
  --repo yourname/agent-config-backup \
  --project-dir /path/to/project
```

The default project set is `CLAUDE.md`, `AGENTS.md`, `.claude`, and `.codex`. Missing paths are recorded in the manifest and skipped.

Back up only part of a project:

```bash
AGENT_AUTH_BACKUP_PASSPHRASE='change-me' \
agent-auth backup project \
  --repo yourname/agent-config-backup \
  --project-dir /path/to/project \
  --include AGENTS.md \
  --include .codex
```

Restore the latest full project snapshot:

```bash
AGENT_AUTH_BACKUP_PASSPHRASE='change-me' \
agent-auth restore project \
  --repo yourname/agent-config-backup \
  --project-dir /path/to/project \
  --snapshot latest
```

Restore only part of a project snapshot:

```bash
AGENT_AUTH_BACKUP_PASSPHRASE='change-me' \
agent-auth restore project \
  --repo yourname/agent-config-backup \
  --project-dir /path/to/project \
  --snapshot latest \
  --include AGENTS.md \
  --include .codex
```

Restore behavior:

- Restore writes into `--project-dir`.
- Existing files or directories are copied to `.agent-auth-restore-backup/<timestamp>/` before being replaced.
- `--include` on restore is matched against paths inside the snapshot.
- Machine restore is intentionally not provided yet because home-directory credential overwrite policy needs a separate explicit decision.

Backup repository layout:

```text
machine/<hostname>/<timestamp>-machine-<hostname>.zip.enc
machine/<hostname>/<timestamp>-machine-<hostname>.json
projects/<project-name>/<timestamp>-project-<project-name>.zip.enc
projects/<project-name>/<timestamp>-project-<project-name>.json
```

The `.json` manifest stores non-secret metadata such as timestamp, hostname, project name, included paths, and missing paths. The archive contents are encrypted before being committed.

## Examples

### Codex

```bash
agent-auth codex add packycode \
  --name "Packy Code CN" \
  --url "https://codex-api-slb.packycode.com/v1" \
  --key "sk-xxxx" \
  --model "gpt-5.4"
```

```bash
agent-auth codex use packycode
agent-auth codex status
agent-auth codex official
agent-auth codex sessions 2026 --short-id
```

### Claude

This command renders the provider into `~/.claude/settings.json` under `env`.

```bash
agent-auth claude add packy \
  --name "Packy Claude" \
  --url "https://www.packyapi.com" \
  --key "xxx"
```

Rendered shape:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://www.packyapi.com",
    "ANTHROPIC_AUTH_TOKEN": "xxx",
    "CLAUDE_CODE_ATTRIBUTION_HEADER": "0",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    "CLAUDE_CODE_DISABLE_TERMINAL_TITLE": "1"
  }
}
```

Extra env example:

```bash
agent-auth claude update packy \
  --env CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000
```

### Gemini

This command renders the provider into `~/.gemini/.env`.

```bash
agent-auth gemini add packy \
  --name "Packy Gemini" \
  --url "https://www.packyapi.com" \
  --key "xxx"
```

Rendered shape:

```dotenv
GOOGLE_GEMINI_BASE_URL=https://www.packyapi.com
GEMINI_API_KEY=xxx
```

Extra env example:

```bash
agent-auth gemini update packy \
  --env GEMINI_MODEL=gemini-2.5-pro
```

## Status And List

```bash
agent-auth claude list
agent-auth gemini status
```

Example list output:

```text
Providers: claude
PROVIDER_ID  NAME           BASE_URL                   MODEL  ENV_KEYS                                   UPDATED_AT
-----------  -------------  -------------------------  -----  -----------------------------------------  --------------------
packy        Packy Claude   https://www.packyapi.com   -      -                                          2026-04-02T12:00:00Z
```

## Official Mode

- `agent-auth codex official`: restore backed-up official auth when available; otherwise remove managed API-key auth and disable `model_provider`.
- `agent-auth claude official`: restore backed-up `settings.json` when available; otherwise clear managed Claude env keys.
- `agent-auth gemini official`: restore backed-up `.env` when available; otherwise clear managed Gemini env keys.

## Notes

- The old `codex-auth` entrypoint is intentionally removed. Use `agent-auth <agent> ...`.
- Existing legacy `~/.codex-auth/providers/*.json` and official Codex backup are migrated into the new registry on first `agent-auth codex ...` run.
- `codex` still uses OpenAI-compatible provider rendering and writes `OPENAI_API_KEY` into `~/.codex/auth.json`.
