import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";

const CLI_PATH = new URL("../bin/agent-trace-audit.js", import.meta.url).pathname;

function createAntigravityFixture() {
  const root = mkdtempSync(join(tmpdir(), "ata-antigravity-"));
  const agyRoot = join(root, "antigravity");
  const sessionId = "antigravity-sess-001";
  const logsDir = join(agyRoot, "brain", sessionId, ".system_generated", "logs");
  mkdirSync(logsDir, { recursive: true });

  const db = new DatabaseSync(join(agyRoot, "conversation_summaries.db"));
  db.exec(`
    CREATE TABLE conversation_summaries (
      conversation_id TEXT PRIMARY KEY,
      title TEXT,
      last_modified_time TEXT,
      step_count INTEGER,
      workspace_uris TEXT,
      status TEXT
    );
  `);
  db.prepare(`
    INSERT INTO conversation_summaries (conversation_id, title, last_modified_time, step_count, workspace_uris, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    sessionId,
    "Fix auth race",
    "2026-10-12 14:00:00",
    4,
    JSON.stringify(["file:///tmp/demo"]),
    "COMPLETED"
  );
  db.close();

  const transcriptLines = [
    JSON.stringify({
      step_index: 1,
      type: "USER_INPUT",
      created_at: "2026-10-12T13:55:00.000Z",
      content: "<USER_REQUEST>Fix the auth race condition</USER_REQUEST>",
    }),
    JSON.stringify({
      step_index: 2,
      type: "PLANNER_RESPONSE",
      created_at: "2026-10-12T13:56:00.000Z",
      input_tokens: 1000,
      cache_read_tokens: 400,
      output_tokens: 200,
      tool_calls: [
        { name: "run_command", arguments: { CommandLine: "npm test" } },
      ],
    }),
    JSON.stringify({
      step_index: 3,
      type: "TOOL_RESULT",
      status: "ERROR",
      created_at: "2026-10-12T13:56:10.000Z",
      content: "Test failed with exit code 1",
    }),
    JSON.stringify({
      step_index: 4,
      type: "PLANNER_RESPONSE",
      created_at: "2026-10-12T13:57:00.000Z",
      input_tokens: 1200,
      cache_read_tokens: 800,
      output_tokens: 100,
      tool_calls: [{ name: "read_file", arguments: { Path: "/tmp/demo/auth.js" } }],
    }),
  ];

  writeFileSync(join(logsDir, "transcript.jsonl"), transcriptLines.join("\n") + "\n");
  return { root, agyRoot, sessionId };
}

test("list and summary --json audit an Antigravity Session Trace end-to-end", () => {
  const { root, agyRoot, sessionId } = createAntigravityFixture();
  try {
    const listOut = execFileSync(
      process.execPath,
      [CLI_PATH, "list", "--data-dir", agyRoot],
      { encoding: "utf8" }
    );
    assert.match(listOut, /antigravity-sess-001/);
    assert.match(listOut, /Fix auth race/);
    assert.match(listOut, /antigravity/);

    const jsonOut = execFileSync(
      process.execPath,
      [CLI_PATH, "summary", sessionId, "--data-dir", agyRoot, "--json"],
      { encoding: "utf8" }
    );
    const trace = JSON.parse(jsonOut);
    assert.equal(trace.id, sessionId);
    assert.equal(trace.agent, "antigravity");
    assert.equal(trace.title, "Fix auth race");
    assert.equal(trace.status, "COMPLETED");
    assert.equal(trace.turns.length, 3);
    assert.equal(trace.toolInvocations.length, 2);
    assert.deepEqual(trace.diagnostics.tokens, {
      promptTokens: 2200,
      cacheReadTokens: 1200,
      uncachedInputTokens: 1000,
      outputTokens: 300,
      totalTokens: 2500,
    });
    assert.equal(trace.diagnostics.tokenEconomics.estimatedCostUsd, 0.002);
    assert.equal(trace.diagnostics.toolErrorsCount, 1);

    const textOut = execFileSync(
      process.execPath,
      [CLI_PATH, "summary", sessionId, "--data-dir", agyRoot],
      { encoding: "utf8" }
    );
    assert.match(textOut, /Fix auth race/);
    assert.match(textOut, /run_command/);
    assert.match(textOut, /\$0\.002/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
