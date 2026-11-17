---
name: agent-trace-audit
description: Run deterministic local forensics on Antigravity, Claude Code, and Codex CLI session traces before conducting a retrospective or diagnosing tool loops and token waste.
---

# Agent Trace Audit

Use `agent-trace-audit` to extract exact **Token Economics**, **Cache Efficiency**, **Thrash Loops**, and **Tool Invocation** histories from local coding-agent logs without burning context window reading raw JSONL or SQLite files.

## Commands

```bash
# List recent sessions (optionally filter by agent)
npx agent-trace-audit list [--agent antigravity|claude-code|codex] [--json]

# Audit a single session (supports unique ID prefix)
npx agent-trace-audit summary <session-id> [--json]

# Inspect shell commands executed during a session
npx agent-trace-audit show-command <session-id> [--json]

# Generate a Markdown portfolio report across all sessions
npx agent-trace-audit report-all [--agent <name>] [--output report.md]
```

## Using with `/retro`

1. Run `summary <session-id> --json` first.
2. Check `diagnostics.thrashLoops` for consecutive identical or failing tool calls.
3. Check `diagnostics.cacheEfficiency.warning` and `diagnostics.topTokenTurns` for context-invalidation or prompt-bloat turns.
4. Run `show-command <session-id>` to audit failing shell commands before proposing environment or guardrail fixes.
