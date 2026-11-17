# 0002 Deterministic Forensics CLI with Companion Skill

## Status

accepted

## Context

Qualitative retrospective skills (such as `/retro`) instruct an agent to inspect raw session logs on disk, which burns context window and produces inconsistent token/cost numbers. Meanwhile, existing scripts like `llm-skills/scripts/agy-audit.mjs` proved that zero-dependency Node.js (`node:sqlite` + JSONL parsing) can extract exact telemetry in milliseconds.

## Decision

Build `agent-trace-audit` as a **zero-dependency deterministic Node.js CLI** (producing human-readable reports and machine-readable `--json` output) paired with a single companion `SKILL.md` for LLM-assisted retrospectives, rather than an LLM-powered log-reading prompt.

## Consequences

- Forensics, Thrash Loop detection, and Cache Efficiency checks run instantaneously, offline, and with zero LLM token cost, and can be unit-tested deterministically.
- Retrospective skills (`/retro` or the companion `SKILL.md`) become lightweight consumers of structured CLI output instead of raw-log parsers.
