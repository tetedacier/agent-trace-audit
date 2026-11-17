#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createAuditor } from "../src/audit.js";
import { validatePricing } from "../src/diagnostics.js";
import {
  extractCommandInvocations,
  formatCommands,
  formatPortfolioReport,
  formatSessionList,
  formatSessionSummary,
} from "../src/formatters.js";

function parseCliArgs(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      json: { type: "boolean", default: false },
      "data-dir": { type: "string" },
      output: { type: "string" },
      agent: { type: "string" },
      pricing: { type: "string" },
    },
  });

  return {
    command: positionals[0] || "list",
    target: positionals[1],
    dataDir: values["data-dir"],
    output: values.output,
    agent: values.agent,
    pricingPath: values.pricing,
    json: values.json,
  };
}

function main() {
  const { command, target, dataDir, output, agent, pricingPath, json } = parseCliArgs(process.argv.slice(2));
  const pricing = pricingPath ? validatePricing(JSON.parse(readFileSync(pricingPath, "utf8"))) : undefined;
  const auditor = createAuditor({ dataDir, pricing });

  if (command === "list") {
    const sessions = auditor.listSessions({ agent });
    console.log(json ? JSON.stringify(sessions, null, 2) : formatSessionList(sessions));
    return;
  }

  if (command === "summary") {
    if (!target) {
      console.error("Usage: agent-trace-audit summary <session-id>");
      process.exitCode = 1;
      return;
    }
    const trace = auditor.auditSession(target);
    console.log(json ? JSON.stringify(trace, null, 2) : formatSessionSummary(trace));
    return;
  }

  if (command === "show-command") {
    if (!target) {
      console.error("Usage: agent-trace-audit show-command <session-id>");
      process.exitCode = 1;
      return;
    }
    const trace = auditor.auditSession(target);
    console.log(json ? JSON.stringify(extractCommandInvocations(trace), null, 2) : formatCommands(trace));
    return;
  }

  if (command === "report-all") {
    const traces = auditor.auditAllSessions({ agent });
    const content = json ? JSON.stringify(traces, null, 2) : formatPortfolioReport(traces);
    if (output) {
      writeFileSync(output, content, "utf8");
      console.log(`Report written to ${output}`);
    } else {
      console.log(content);
    }
    return;
  }

  console.error(`Unknown command: ${command}`);
  process.exitCode = 1;
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
