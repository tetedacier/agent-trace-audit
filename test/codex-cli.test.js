import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const CLI_PATH = new URL("../bin/agent-trace-audit.js", import.meta.url).pathname;

function createCodexFixture() {
  const root = mkdtempSync(join(tmpdir(), "ata-codex-"));
  const sessDir = join(root, "codex", "sessions", "2026", "10", "15");
  mkdirSync(sessDir, { recursive: true });

  const lines = [
    JSON.stringify({
      timestamp: "2026-10-15T11:00:00.000Z",
      type: "session_meta",
      payload: { id: "codex-sess-001", cwd: "/tmp/codex-app", timestamp: "2026-10-15T11:00:00.000Z" },
    }),
    JSON.stringify({
      timestamp: "2026-10-15T11:00:01.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Check git status" }],
      },
    }),
    JSON.stringify({
      timestamp: "2026-10-15T11:00:03.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "shell",
        call_id: "call_1",
        arguments: JSON.stringify({ command: "git status" }),
      },
    }),
    JSON.stringify({
      timestamp: "2026-10-15T11:00:04.000Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call_1",
        output: JSON.stringify({ output: "clean", metadata: { exit_code: 1 } }),
      },
    }),
    JSON.stringify({
      timestamp: "2026-10-15T11:00:05.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          last_token_usage: { input_tokens: 900, cached_input_tokens: 300, output_tokens: 120 },
        },
      },
    }),
  ];

  writeFileSync(join(sessDir, "rollout-codex-001.jsonl"), lines.join("\n") + "\n");
  return { root };
}

test("Codex CLI TraceAdapter normalizes rollout JSONL sessions end-to-end", () => {
  const { root } = createCodexFixture();
  try {
    const listOut = execFileSync(
      process.execPath,
      [CLI_PATH, "list", "--data-dir", root, "--agent", "codex"],
      { encoding: "utf8" }
    );
    assert.match(listOut, /codex-sess-001/);
    assert.match(listOut, /codex/);

    const trace = JSON.parse(
      execFileSync(
        process.execPath,
        [CLI_PATH, "summary", "codex-sess-001", "--data-dir", root, "--json"],
        { encoding: "utf8" }
      )
    );
    assert.equal(trace.agent, "codex");
    assert.equal(trace.workspace, "/tmp/codex-app");
    assert.equal(trace.toolInvocations.length, 1);
    assert.equal(trace.toolInvocations[0].name, "shell");
    assert.equal(trace.toolInvocations[0].command, "git status");
    assert.equal(trace.toolInvocations[0].isError, true);
    assert.deepEqual(trace.diagnostics.tokens, {
      promptTokens: 900,
      cacheReadTokens: 300,
      uncachedInputTokens: 600,
      outputTokens: 120,
      totalTokens: 1020,
    });

    const cmds = JSON.parse(
      execFileSync(
        process.execPath,
        [CLI_PATH, "show-command", "codex-sess-001", "--data-dir", root, "--json"],
        { encoding: "utf8" }
      )
    );
    assert.equal(cmds.length, 1);
    assert.equal(cmds[0].command, "git status");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
