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

function formatHelp() {
  return [
    "Usage: agent-trace-audit <command> [options]",
    "",
    "Commands:",
    "  list                       List discovered local Session Traces",
    "  summary <session-id>       Audit a Session Trace (supports unique ID prefix)",
    "  show-command <session-id>  List shell commands executed in a Session Trace",
    "  report-all                 Generate a Markdown portfolio report",
    "  help                       Show this help message",
    "",
    "Options:",
    "  --data-dir <path>          Override default trace directory",
    "  --agent <name>             Filter by agent (antigravity, claude-code, codex)",
    "  --pricing <path.json>      Custom per-million token pricing JSON file",
    "  --output <path>            Write report-all output to a file",
    "  --json                     Emit machine-readable JSON output",
    "  -h, --help                 Show this help message",
  ].join("\n");
}

function parseCliArgs(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      "data-dir": { type: "string" },
      output: { type: "string" },
      agent: { type: "string" },
      pricing: { type: "string" },
    },
  });

  return {
    command: values.help ? "help" : positionals[0] || "help",
    target: positionals[1],
    dataDir: values["data-dir"],
    output: values.output,
    agent: values.agent,
    pricingPath: values.pricing,
    json: values.json,
  };
}

function main() {
  let parsed;
  try {
    parsed = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`${err.message}\n\n${formatHelp()}`);
    process.exitCode = 1;
    return;
  }

  const { command, target, dataDir, output, agent, pricingPath, json } = parsed;

  if (command === "help") {
    console.log(formatHelp());
    return;
  }

  const pricing = pricingPath ? validatePricing(JSON.parse(readFileSync(pricingPath, "utf8"))) : undefined;
  const auditor = createAuditor({ dataDir, pricing });

  if (command === "list") {
    const sessions = auditor.listSessions({ agent });
    console.log(json ? JSON.stringify(sessions, null, 2) : formatSessionList(sessions));
    return;
  }

  if (command === "summary") {
    if (!target) {
      console.error(`Usage: agent-trace-audit summary <session-id>\n\n${formatHelp()}`);
      process.exitCode = 1;
      return;
    }
    const trace = auditor.auditSession(target);
    console.log(json ? JSON.stringify(trace, null, 2) : formatSessionSummary(trace));
    return;
  }

  if (command === "show-command") {
    if (!target) {
      console.error(`Usage: agent-trace-audit show-command <session-id>\n\n${formatHelp()}`);
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

  console.error(`Unknown command: ${command}\n\n${formatHelp()}`);
  process.exitCode = 1;
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
