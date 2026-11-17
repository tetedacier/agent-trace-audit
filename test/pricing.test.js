import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const CLI_PATH = new URL("../bin/agent-trace-audit.js", import.meta.url).pathname;

test("supports custom model pricing table via --pricing", () => {
  const root = mkdtempSync(join(tmpdir(), "ata-pricing-"));
  const projDir = join(root, "claude", "projects", "demo");
  mkdirSync(projDir, { recursive: true });

  writeFileSync(
    join(projDir, "pricing-sess.jsonl"),
    [
      JSON.stringify({
        type: "user",
        sessionId: "pricing-sess",
        message: { role: "user", content: "hello" },
      }),
      JSON.stringify({
        type: "assistant",
        sessionId: "pricing-sess",
        message: {
          role: "assistant",
          usage: { input_tokens: 1000, cache_read_input_tokens: 600, output_tokens: 150 },
          content: [],
        },
      }),
    ].join("\n") + "\n"
  );

  const pricingPath = join(root, "pricing.json");
  writeFileSync(
    pricingPath,
    JSON.stringify({
      name: "claude-sonnet-custom",
      uncachedInputPerM: 3.0,
      cacheReadPerM: 0.3,
      outputPerM: 15.0,
    })
  );

  try {
    const trace = JSON.parse(
      execFileSync(
        process.execPath,
        [CLI_PATH, "summary", "pricing-sess", "--data-dir", root, "--pricing", pricingPath, "--json"],
        { encoding: "utf8" }
      )
    );
    assert.equal(trace.diagnostics.tokenEconomics.modelPricingUsed, "claude-sonnet-custom");
    assert.equal(trace.diagnostics.tokenEconomics.estimatedCostUsd, 0.0054);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
