import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";

const CLI_PATH = new URL("../bin/agent-trace-audit.js", import.meta.url).pathname;

function createDiagnosticFixture() {
  const root = mkdtempSync(join(tmpdir(), "ata-diag-"));
  const agyRoot = join(root, "antigravity");
  mkdirSync(agyRoot, { recursive: true });

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
  const insert = db.prepare(`
    INSERT INTO conversation_summaries (conversation_id, title, last_modified_time, step_count, workspace_uris, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  insert.run("thrash-sess", "Thrashing Run", "2026-10-12 11:00:00", 5, "[]", "COMPLETED");
  const d1 = join(agyRoot, "brain", "thrash-sess", ".system_generated", "logs");
  mkdirSync(d1, { recursive: true });
  writeFileSync(
    join(d1, "transcript.jsonl"),
    [
      JSON.stringify({ step_index: 1, type: "USER_INPUT", content: "fix tests" }),
      JSON.stringify({
        step_index: 2,
        type: "PLANNER_RESPONSE",
        input_tokens: 5000,
        cache_read_tokens: 0,
        output_tokens: 100,
        tool_calls: [{ name: "run_command", arguments: { CommandLine: "npm test" } }],
      }),
      JSON.stringify({ step_index: 3, type: "TOOL_RESULT", status: "ERROR" }),
      JSON.stringify({
        step_index: 4,
        type: "PLANNER_RESPONSE",
        input_tokens: 6000,
        cache_read_tokens: 500,
        output_tokens: 100,
        tool_calls: [{ name: "run_command", arguments: { CommandLine: "npm test" } }],
      }),
      JSON.stringify({ step_index: 5, type: "TOOL_RESULT", status: "ERROR" }),
      JSON.stringify({
        step_index: 6,
        type: "PLANNER_RESPONSE",
        input_tokens: 7000,
        cache_read_tokens: 500,
        output_tokens: 100,
        tool_calls: [{ name: "run_command", arguments: { CommandLine: "npm test" } }],
      }),
      JSON.stringify({ step_index: 7, type: "TOOL_RESULT", status: "ERROR" }),
    ].join("\n") + "\n"
  );

  insert.run("clean-sess", "Clean Run", "2026-10-12 12:00:00", 2, "[]", "COMPLETED");
  const d2 = join(agyRoot, "brain", "clean-sess", ".system_generated", "logs");
  mkdirSync(d2, { recursive: true });
  writeFileSync(
    join(d2, "transcript.jsonl"),
    [
      JSON.stringify({ step_index: 1, type: "USER_INPUT", content: "read readme" }),
      JSON.stringify({
        step_index: 2,
        type: "PLANNER_RESPONSE",
        input_tokens: 12000,
        cache_read_tokens: 10000,
        output_tokens: 200,
        tool_calls: [{ name: "read_file", arguments: { Path: "README.md" } }],
      }),
    ].join("\n") + "\n"
  );

  db.close();
  return { root, agyRoot };
}

test("detects Thrash Loops, low Cache Efficiency, and top token Turns", () => {
  const { root, agyRoot } = createDiagnosticFixture();
  try {
    const thrashTrace = JSON.parse(
      execFileSync(process.execPath, [CLI_PATH, "summary", "thrash-sess", "--data-dir", agyRoot, "--json"], {
        encoding: "utf8",
      })
    );
    assert.equal(thrashTrace.diagnostics.thrashLoops.length, 1);
    assert.equal(thrashTrace.diagnostics.thrashLoops[0].toolName, "run_command");
    assert.equal(thrashTrace.diagnostics.thrashLoops[0].count, 3);
    assert.ok(thrashTrace.diagnostics.cacheEfficiency.hitRatio < 0.2);
    assert.ok(thrashTrace.diagnostics.cacheEfficiency.warning);
    assert.equal(thrashTrace.diagnostics.topTokenTurns[0].index, 4);

    const summaryText = execFileSync(
      process.execPath,
      [CLI_PATH, "summary", "thrash-sess", "--data-dir", agyRoot],
      { encoding: "utf8" }
    );
    assert.match(summaryText, /Thrash Loop/i);
    assert.match(summaryText, /Cache Efficiency/i);

    const cleanTrace = JSON.parse(
      execFileSync(process.execPath, [CLI_PATH, "summary", "clean-sess", "--data-dir", agyRoot, "--json"], {
        encoding: "utf8",
      })
    );
    assert.equal(cleanTrace.diagnostics.thrashLoops.length, 0);
    assert.equal(cleanTrace.diagnostics.cacheEfficiency.warning, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
