#!/usr/bin/env node
import { createAuditor } from "../src/audit.js";
import { formatSessionList, formatSessionSummary } from "../src/formatters.js";

function parseArgs(argv) {
  const positional = [];
  let dataDir;
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--data-dir" && i + 1 < argv.length) {
      dataDir = argv[++i];
    } else if (arg.startsWith("--data-dir=")) {
      dataDir = arg.slice("--data-dir=".length);
    } else {
      positional.push(arg);
    }
  }

  return { command: positional[0] || "list", target: positional[1], dataDir, json };
}

function main() {
  const { command, target, dataDir, json } = parseArgs(process.argv.slice(2));
  const auditor = createAuditor({ dataDir });

  if (command === "list") {
    const sessions = auditor.listSessions();
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

  console.error(`Unknown command: ${command}`);
  process.exitCode = 1;
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
