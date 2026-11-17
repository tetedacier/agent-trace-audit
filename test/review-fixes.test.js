import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { execFileSync, spawnSync } from "node:child_process";

const CLI_PATH = new URL("../bin/agent-trace-audit.js", import.meta.url).pathname;

test("list renders aligned columns, normalized status, turnCount, and workspace", () => {
  const root = mkdtempSync(join(tmpdir(), "ata-list-ui-"));
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
  db.prepare(`
    INSERT INTO conversation_summaries (conversation_id, title, last_modified_time, step_count, workspace_uris, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run("idle-sess-1", "Idle Check", "2026-10-12 14:00:00", 2, JSON.stringify(["file:///tmp/my-repo"]), "CASCADE_RUN_STATUS_IDLE");
  db.close();

  try {
    const out = execFileSync(process.execPath, [CLI_PATH, "list", "--data-dir", root], { encoding: "utf8" });
    assert.match(out, /ID\s+AGENT\s+STATUS\s+LAST MODIFIED\s+WORKSPACE\s+TITLE/);
    assert.match(out, /\bIDLE\b/);
    assert.doesNotMatch(out, /CASCADE_RUN_STATUS_IDLE/);
    assert.match(out, /my-repo/);

    const jsonList = JSON.parse(
      execFileSync(process.execPath, [CLI_PATH, "list", "--data-dir", root, "--json"], { encoding: "utf8" })
    );
    assert.equal(jsonList[0].turnCount, 2);
    assert.equal(jsonList[0].stepCount, undefined);

    // Missing transcript emits warning in summary
    const summaryText = execFileSync(
      process.execPath,
      [CLI_PATH, "summary", "idle-sess-1", "--data-dir", root],
      { encoding: "utf8" }
    );
    assert.match(summaryText, /Warnings:/);
    assert.match(summaryText, /Missing transcript\.jsonl/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("invalid --pricing JSON exits non-zero with a clear validation error", () => {
  const root = mkdtempSync(join(tmpdir(), "ata-bad-price-"));
  const badPricing = join(root, "bad.json");
  writeFileSync(badPricing, JSON.stringify({ name: "incomplete" }));
  try {
    const res = spawnSync(
      process.execPath,
      [CLI_PATH, "list", "--data-dir", root, "--pricing", badPricing],
      { encoding: "utf8" }
    );
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /Invalid pricing configuration/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("summary prints Top Token Turns and avoids misclassifying mixed fail/pass Thrash Loops", () => {
  const root = mkdtempSync(join(tmpdir(), "ata-thrash-mix-"));
  const agyRoot = join(root, "antigravity");
  const logsDir = join(agyRoot, "brain", "mix-sess", ".system_generated", "logs");
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
  `).run("mix-sess", "Mixed Commands", "2026-10-12 14:00:00", 6, "[]", "COMPLETED");
  db.close();

  writeFileSync(
    join(logsDir, "transcript.jsonl"),
    [
      JSON.stringify({
        step_index: 1,
        type: "PLANNER_RESPONSE",
        input_tokens: 1500,
        cache_read_tokens: 500,
        output_tokens: 100,
        tool_calls: [{ name: "run_command", arguments: { CommandLine: "cmdA" } }],
      }),
      JSON.stringify({ step_index: 2, type: "TOOL_RESULT", status: "ERROR" }),
      JSON.stringify({
        step_index: 3,
        type: "PLANNER_RESPONSE",
        input_tokens: 1600,
        cache_read_tokens: 500,
        output_tokens: 100,
        tool_calls: [{ name: "run_command", arguments: { CommandLine: "cmdB" } }],
      }),
      JSON.stringify({ step_index: 4, type: "TOOL_RESULT", status: "ERROR" }),
      JSON.stringify({
        step_index: 5,
        type: "PLANNER_RESPONSE",
        input_tokens: 2000,
        cache_read_tokens: 500,
        output_tokens: 100,
        tool_calls: [{ name: "run_command", arguments: { CommandLine: "cmdA" } }],
      }),
    ].join("\n") + "\n"
  );

  try {
    const trace = JSON.parse(
      execFileSync(process.execPath, [CLI_PATH, "summary", "mix-sess", "--data-dir", root, "--json"], {
        encoding: "utf8",
      })
    );
    assert.equal(trace.diagnostics.thrashLoops.length, 0);

    const text = execFileSync(process.execPath, [CLI_PATH, "summary", "mix-sess", "--data-dir", root], {
      encoding: "utf8",
    });
    assert.match(text, /Top Token Turns:/);
    assert.match(text, /Turn 3: 2,100 total/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
