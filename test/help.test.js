import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const CLI_PATH = new URL("../bin/agent-trace-audit.js", import.meta.url).pathname;

test("prints help with no command, help, or --help, and prints error + help on unknown command/option", () => {
  for (const args of [[], ["help"], ["--help"], ["-h"]]) {
    const res = spawnSync(process.execPath, [CLI_PATH, ...args], { encoding: "utf8" });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /Usage:/);
    assert.match(res.stdout, /\blist\b/);
    assert.match(res.stdout, /\bsummary\b/);
    assert.match(res.stdout, /\bshow-command\b/);
    assert.match(res.stdout, /\breport-all\b/);
    assert.match(res.stdout, /--data-dir/);
    assert.match(res.stdout, /--agent/);
    assert.match(res.stdout, /--pricing/);
    assert.match(res.stdout, /--json/);
  }

  const badCmd = spawnSync(process.execPath, [CLI_PATH, "unknown-cmd"], { encoding: "utf8" });
  assert.notEqual(badCmd.status, 0);
  assert.match(badCmd.stderr, /Unknown command: unknown-cmd/);
  assert.match(badCmd.stderr, /Usage:/);

  const badOpt = spawnSync(process.execPath, [CLI_PATH, "list", "--bogus-flag"], { encoding: "utf8" });
  assert.notEqual(badOpt.status, 0);
  assert.match(badOpt.stderr, /--bogus-flag/);
  assert.match(badOpt.stderr, /Usage:/);
});
