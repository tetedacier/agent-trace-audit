#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { createAuditor } from "../src/audit.js";
import {
  extractCommandInvocations,
  formatCommands,
  formatPortfolioReport,
  formatSessionList,
  formatSessionSummary,
} from "../src/formatters.js";

function parseArgs(argv) {
  const positional = [];
  let dataDir;
  let output;
  let agent;
  let pricingPath;
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--data-dir" && i + 1 < argv.length) {
      dataDir = argv[++i];
    } else if (arg.startsWith("--data-dir=")) {
      dataDir = arg.slice("--data-dir=".length);
    } else if (arg === "--output" && i + 1 < argv.length) {
      output = argv[++i];
    } else if (arg.startsWith("--output=")) {
      output = arg.slice("--output=".length);
    } else if (arg === "--agent" && i + 1 < argv.length) {
      agent = argv[++i];
    } else if (arg.startsWith("--agent=")) {
      agent = arg.slice("--agent=".length);
    } else if (arg === "--pricing" && i + 1 < argv.length) {
      pricingPath = argv[++i];
    } else if (arg.startsWith("--pricing=")) {
      pricingPath = arg.slice("--pricing=".length);
    } else {
      positional.push(arg);
    }
  }

  return { command: positional[0] || "list", target: positional[1], dataDir, output, agent, pricingPath, json };
}

function main() {
  const { command, target, dataDir, output, agent, pricingPath, json } = parseArgs(process.argv.slice(2));
  const pricing = pricingPath ? JSON.parse(readFileSync(pricingPath, "utf8")) : undefined;
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
