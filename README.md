# agent-trace-audit

Zero-dependency Node.js CLI for deterministic telemetry and orchestration forensics across local agentic CLI session traces (**Antigravity**, **Claude Code**, and **Codex CLI**).

## Why

Qualitative retrospective workflows (like `/retro`) often ask an agent to search and read raw session logs, burning context window and producing inconsistent numbers. `agent-trace-audit` parses local SQLite/JSONL traces deterministically in milliseconds with zero external dependencies, giving both humans and agents exact metrics:

- **Token Economics**: uncached input, cache-read, output, total tokens, and estimated USD cost (with configurable `--pricing`).
- **Cache Efficiency**: prompt-cache hit ratio and low-cache warnings on non-trivial sessions.
- **Thrash Loop Detection**: flags 3+ consecutive identical or failing Tool Invocations.
- **Command & Portfolio Audits**: `show-command` per session and `report-all` Markdown portfolio summaries.

## Architecture

```
Antigravity (SQLite + JSONL) ─┐
Claude Code (JSONL)          ─┼─▶ TraceAdapter ─▶ Normalized SessionTrace ─▶ Diagnostics Engine ─▶ CLI / --json / Markdown
Codex CLI (Rollout JSONL)    ─┘
```

- **Zero dependencies**: built solely on Node.js 22.5+ built-ins (`node:sqlite`, `node:test`, `node:fs`, `node:assert/strict`).
- **Domain & ADRs**: see [`GLOSSARY.md`](./GLOSSARY.md) and [`docs/adr/`](./docs/adr/).

## Quickstart

```bash
# List discovered sessions
node bin/agent-trace-audit.js list

# Filter by agent
node bin/agent-trace-audit.js list --agent claude-code

# Audit a session (supports unique ID prefix)
node bin/agent-trace-audit.js summary <id-prefix>

# Machine-readable JSON for scripts and /retro
node bin/agent-trace-audit.js summary <id-prefix> --json

# Audit shell commands run during a session
node bin/agent-trace-audit.js show-command <id-prefix>

# Generate a Markdown portfolio report
node bin/agent-trace-audit.js report-all --output portfolio.md
```

### Options

- `--data-dir <path>`: override the default home-directory trace location
- `--agent <antigravity|claude-code|codex>`: filter `list` or `report-all`
- `--pricing <path.json>`: override default per-million token rates
- `--json`: emit stable JSON output

## Testing

```bash
npm test
```

All tests run via `node --test` against temporary fixture directories without touching your `$HOME` session logs.
