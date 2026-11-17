# Agent Trace Audit

Deterministic CLI telemetry and orchestration forensics for local agentic CLI session traces (Antigravity, Claude Code, Codex CLI).

## Language

**Session Trace**:
The normalized, agent-agnostic record of a single coding-agent run, including its turns, tool invocations, token accounting, and timestamps.
_Avoid_: Conversation, chat log, transcript

**Trace Adapter**:
A format-specific reader that maps one coding agent's local storage (SQLite, JSONL) into a normalized Session Trace.
_Avoid_: Parser, connector, driver

**Turn**:
A single user prompt or model response cycle within a Session Trace, carrying its own token counts and any emitted Tool Invocations.
_Avoid_: Message, exchange, step

**Tool Invocation**:
One tool or shell command executed by an agent during a Turn, along with its normalized name, arguments summary, and success/error outcome.
_Avoid_: Function call, action, command

**Thrash Loop**:
A consecutive sequence of identical or repeatedly failing Tool Invocations that signals an agent is stuck rather than making forward progress.
_Avoid_: Infinite loop, retry storm, repetition

**Cache Efficiency**:
The ratio of cached prompt-input tokens to total prompt-input tokens across a Session Trace, used to spot context-invalidation waste.
_Avoid_: Prompt savings, token discount

**Token Economics**:
The breakdown of uncached input, cache-read, and output tokens paired with estimated API cost for a Session Trace.
_Avoid_: Billing, pricing, cost
