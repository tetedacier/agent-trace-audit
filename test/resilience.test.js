import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { execFileSync, spawnSync } from "node:child_process";

const CLI_PATH = new URL("../bin/agent-trace-audit.js", import.meta.url).pathname;

function createFixtureWithSessions(sessions) {
  const root = mkdtempSync(join(tmpdir(), "ata-resilience-"));
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

  for (const s of sessions) {
    insert.run(s.id, s.title, "2026-10-12 14:00:00", s.lines?.length || 0, "[]", "COMPLETED");
    if (s.lines) {
      const logsDir = join(agyRoot, "brain", s.id, ".system_generated", "logs");
      mkdirSync(logsDir, { recursive: true });
      writeFileSync(join(logsDir, "transcript.jsonl"), s.lines.join("\n") + "\n");
    }
  }
  db.close();
  return { root, agyRoot };
}

test("resolves unique ID prefix, rejects ambiguous/unknown IDs, and skips malformed JSONL lines", () => {
  const { root, agyRoot } = createFixtureWithSessions([
    {
      id: "alpha-1111-session",
      title: "Alpha One",
      lines: [
        JSON.stringify({ step_index: 1, type: "USER_INPUT", content: "hi" }),
        "{not valid json",
        JSON.stringify({ step_index: 2, type: "PLANNER_RESPONSE", input_tokens: 500, output_tokens: 50 }),
      ],
    },
    {
      id: "alpha-2222-session",
      title: "Alpha Two",
      lines: [],
    },
  ]);

  try {
    // Unique prefix resolves
    const uniqueOut = execFileSync(
      process.execPath,
      [CLI_PATH, "summary", "alpha-1111", "--data-dir", agyRoot, "--json"],
      { encoding: "utf8" }
    );
    const trace = JSON.parse(uniqueOut);
    assert.equal(trace.id, "alpha-1111-session");
    assert.equal(trace.turns.length, 2);
    assert.equal(trace.warnings.length, 1);

    // Ambiguous prefix fails cleanly with candidate list
    const ambig = spawnSync(
      process.execPath,
      [CLI_PATH, "summary", "alpha-", "--data-dir", agyRoot],
      { encoding: "utf8" }
    );
    assert.notEqual(ambig.status, 0);
    assert.match(ambig.stderr, /alpha-1111-session/);
    assert.match(ambig.stderr, /alpha-2222-session/);

    // Unknown ID fails cleanly
    const missing = spawnSync(
      process.execPath,
      [CLI_PATH, "summary", "nonexistent", "--data-dir", agyRoot],
      { encoding: "utf8" }
    );
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /not found/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
