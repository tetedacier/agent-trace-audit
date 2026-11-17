import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const CLI_PATH = new URL("../bin/agent-trace-audit.js", import.meta.url).pathname;

function createClaudeFixture() {
  const root = mkdtempSync(join(tmpdir(), "ata-claude-"));
  const projectDir = join(root, "claude", "projects", "my-app");
  mkdirSync(projectDir, { recursive: true });

  const lines = [
    JSON.stringify({
      type: "user",
      sessionId: "claude-sess-001",
      cwd: "/tmp/my-app",
      timestamp: "2026-10-15T10:00:00.000Z",
      message: { role: "user", content: "Run the test suite" },
    }),
    JSON.stringify({
      type: "assistant",
      sessionId: "claude-sess-001",
      timestamp: "2026-10-15T10:00:05.000Z",
      message: {
        role: "assistant",
        usage: {
          input_tokens: 1000,
          cache_read_input_tokens: 600,
          output_tokens: 150,
        },
        content: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "Bash",
            input: { command: "npm test" },
          },
        ],
      },
    }),
    JSON.stringify({
      type: "user",
      sessionId: "claude-sess-001",
      timestamp: "2026-10-15T10:00:10.000Z",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_1",
            is_error: true,
            content: "exit code 1",
          },
        ],
      },
    }),
  ];

  writeFileSync(join(projectDir, "claude-sess-001.jsonl"), lines.join("\n") + "\n");
  return { root };
}

test("Claude Code TraceAdapter and --agent filter work end-to-end", () => {
  const { root } = createClaudeFixture();
  try {
    const listOut = execFileSync(
      process.execPath,
      [CLI_PATH, "list", "--data-dir", root, "--agent", "claude-code"],
      { encoding: "utf8" }
    );
    assert.match(listOut, /claude-sess-001/);
    assert.match(listOut, /claude-code/);

    const emptyOther = execFileSync(
      process.execPath,
      [CLI_PATH, "list", "--data-dir", root, "--agent", "antigravity"],
      { encoding: "utf8" }
    );
    assert.match(emptyOther, /No Session Traces found/);

    const trace = JSON.parse(
      execFileSync(
        process.execPath,
        [CLI_PATH, "summary", "claude-sess-001", "--data-dir", root, "--json"],
        { encoding: "utf8" }
      )
    );
    assert.equal(trace.agent, "claude-code");
    assert.equal(trace.workspace, "/tmp/my-app");
    assert.equal(trace.toolInvocations.length, 1);
    assert.equal(trace.toolInvocations[0].name, "Bash");
    assert.equal(trace.toolInvocations[0].command, "npm test");
    assert.equal(trace.toolInvocations[0].isError, true);
    assert.deepEqual(trace.diagnostics.tokens, {
      promptTokens: 1600,
      cacheReadTokens: 600,
      uncachedInputTokens: 1000,
      outputTokens: 150,
      totalTokens: 1750,
    });
    assert.equal(trace.diagnostics.toolErrorsCount, 1);

    const cmds = JSON.parse(
      execFileSync(
        process.execPath,
        [CLI_PATH, "show-command", "claude-sess-001", "--data-dir", root, "--json"],
        { encoding: "utf8" }
      )
    );
    assert.equal(cmds.length, 1);
    assert.equal(cmds[0].command, "npm test");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
