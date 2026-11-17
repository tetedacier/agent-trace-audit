import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";

const CLI_PATH = new URL("../bin/agent-trace-audit.js", import.meta.url).pathname;

function createPortfolioFixture() {
  const root = mkdtempSync(join(tmpdir(), "ata-report-"));
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

  insert.run("sess-cmd-1", "Build CLI", "2026-10-12 10:00:00", 3, "[]", "COMPLETED");
  const dir1 = join(agyRoot, "brain", "sess-cmd-1", ".system_generated", "logs");
  mkdirSync(dir1, { recursive: true });
  writeFileSync(
    join(dir1, "transcript.jsonl"),
    [
      JSON.stringify({ step_index: 1, type: "USER_INPUT", created_at: "2026-10-12T09:58:00Z", content: "build it" }),
      JSON.stringify({
        step_index: 2,
        type: "PLANNER_RESPONSE",
        created_at: "2026-10-12T09:59:00Z",
        input_tokens: 1000,
        cache_read_tokens: 0,
        output_tokens: 100,
        tool_calls: [
          { name: "run_command", arguments: { CommandLine: "npm test" } },
          { name: "read_file", arguments: { Path: "README.md" } },
        ],
      }),
      JSON.stringify({ step_index: 3, type: "TOOL_RESULT", status: "ERROR", created_at: "2026-10-12T09:59:05Z" }),
      JSON.stringify({
        step_index: 4,
        type: "PLANNER_RESPONSE",
        created_at: "2026-10-12T10:00:00Z",
        input_tokens: 1000,
        cache_read_tokens: 500,
        output_tokens: 100,
        tool_calls: [{ name: "run_command", arguments: { CommandLine: "git status" } }],
      }),
    ].join("\n") + "\n"
  );

  db.close();
  return { root, agyRoot };
}

test("show-command and report-all output command audits and Markdown portfolio reports", () => {
  const { root, agyRoot } = createPortfolioFixture();
  try {
    const cmdJson = execFileSync(
      process.execPath,
      [CLI_PATH, "show-command", "sess-cmd-1", "--data-dir", agyRoot, "--json"],
      { encoding: "utf8" }
    );
    const commands = JSON.parse(cmdJson);
    assert.equal(commands.length, 2);
    assert.equal(commands[0].command, "npm test");
    assert.equal(commands[0].turnIndex, 2);
    assert.equal(commands[1].command, "git status");

    const cmdText = execFileSync(
      process.execPath,
      [CLI_PATH, "show-command", "sess-cmd-1", "--data-dir", agyRoot],
      { encoding: "utf8" }
    );
    assert.match(cmdText, /npm test/);
    assert.match(cmdText, /git status/);

    const mdStdout = execFileSync(
      process.execPath,
      [CLI_PATH, "report-all", "--data-dir", agyRoot],
      { encoding: "utf8" }
    );
    assert.match(mdStdout, /# Agent Trace Audit Portfolio Report/);
    assert.match(mdStdout, /Build CLI/);
    assert.match(mdStdout, /run_command/);

    const outPath = join(root, "portfolio.md");
    execFileSync(
      process.execPath,
      [CLI_PATH, "report-all", "--data-dir", agyRoot, "--output", outPath],
      { encoding: "utf8" }
    );
    const written = readFileSync(outPath, "utf8");
    assert.match(written, /# Agent Trace Audit Portfolio Report/);
    assert.match(written, /Build CLI/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
