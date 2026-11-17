# 0001 Target Agentic CLI Tools Only in v1

## Status

accepted

## Context

Coding agents store local session history in very different ways. CLI-first agents (Antigravity, Claude Code, Codex CLI) write structured JSONL transcripts or readable SQLite databases with explicit turn, tool-call, and token-usage fields. IDE-embedded tools (Cursor, GitHub Copilot) store state inside opaque IDE storage (`state.vscdb`, extension workspace JSON) whose internal schemas are undocumented, change across releases, or omit token/cache metrics.

## Decision

`agent-trace-audit` v1 supports only agentic CLI tools — specifically **Antigravity**, **Claude Code**, and **Codex CLI** — behind a shared Trace Adapter interface. IDE-embedded tools (Cursor, Copilot) are explicitly out of scope for v1.

## Consequences

- Maintenance stays sustainable for a single maintainer because the supported formats are stable, inspectable JSONL/SQLite schemas.
- All v1 adapters can reliably populate the same normalized Session Trace fields, including cache-read tokens and tool error outcomes.
