export function formatSessionList(sessions) {
  if (sessions.length === 0) {
    return "No Session Traces found.";
  }
  const lines = [
    `Found ${sessions.length} Session Trace(s):`,
    "",
  ];
  for (const s of sessions) {
    lines.push(`${s.id}  [${s.agent}]  ${s.status}  ${s.lastModifiedAt || "-"}  ${s.title}`);
  }
  return lines.join("\n");
}

export function formatSessionSummary(trace) {
  const { tokens, tokenEconomics, cacheEfficiency, thrashLoops, toolCallStats, toolErrorsCount } = trace.diagnostics;
  const userTurns = trace.turns.filter((t) => t.role === "user").length;
  const modelTurns = trace.turns.filter((t) => t.role === "assistant").length;

  const lines = [
    `Session Trace: ${trace.title} (${trace.id})`,
    `Agent: ${trace.agent} | Status: ${trace.status}`,
    `Turns: ${userTurns} user, ${modelTurns} assistant`,
    `Tool Invocations: ${trace.toolInvocations.length} (errors: ${toolErrorsCount})`,
    `Tokens: ${tokens.totalTokens.toLocaleString()} total (${tokens.uncachedInputTokens.toLocaleString()} uncached, ${tokens.cacheReadTokens.toLocaleString()} cached, ${tokens.outputTokens.toLocaleString()} output)`,
    `Cache Efficiency: ${(cacheEfficiency.hitRatio * 100).toFixed(1)}%${cacheEfficiency.warning ? ` [WARNING: ${cacheEfficiency.warning}]` : ""}`,
    `Estimated Cost: $${tokenEconomics.estimatedCostUsd}`,
  ];

  if (thrashLoops.length > 0) {
    lines.push("", "Thrash Loops:");
    for (const loop of thrashLoops) {
      lines.push(`  - ${loop.toolName} (${loop.count}x, turns ${loop.startTurn}-${loop.endTurn}, ${loop.reason}): ${loop.summary}`);
    }
  }

  const toolEntries = Object.entries(toolCallStats).sort((a, b) => b[1] - a[1]);
  if (toolEntries.length > 0) {
    lines.push("", "Tools:");
    for (const [name, count] of toolEntries) {
      lines.push(`  - ${name}: ${count}`);
    }
  }

  return lines.join("\n");
}

export function extractCommandInvocations(trace) {
  return trace.toolInvocations.filter((inv) => Boolean(inv.command));
}

export function formatCommands(trace) {
  const commands = extractCommandInvocations(trace);
  if (commands.length === 0) {
    return `No shell command Tool Invocations found for ${trace.id}.`;
  }
  const lines = [`Shell commands for ${trace.title} (${trace.id}):`, ""];
  for (const cmd of commands) {
    const status = cmd.isError ? "ERROR" : "OK";
    lines.push(`[Turn ${cmd.turnIndex}] (${status}) ${cmd.timestamp || "-"}  $ ${cmd.command}`);
  }
  return lines.join("\n");
}

export function formatPortfolioReport(traces) {
  let totalTurns = 0;
  let totalTools = 0;
  let totalErrors = 0;
  let totalTokens = 0;
  let totalCost = 0;
  const aggregatedTools = {};

  for (const t of traces) {
    totalTurns += t.turns.length;
    totalTools += t.toolInvocations.length;
    totalErrors += t.diagnostics.toolErrorsCount;
    totalTokens += t.diagnostics.tokens.totalTokens;
    totalCost += t.diagnostics.tokenEconomics.estimatedCostUsd;
    for (const [name, count] of Object.entries(t.diagnostics.toolCallStats)) {
      aggregatedTools[name] = (aggregatedTools[name] || 0) + count;
    }
  }

  const lines = [
    "# Agent Trace Audit Portfolio Report",
    "",
    "## Executive Summary",
    "",
    `- **Total Audited Sessions**: ${traces.length}`,
    `- **Total Turns**: ${totalTurns}`,
    `- **Total Tool Invocations**: ${totalTools} (errors: ${totalErrors})`,
    `- **Total Tokens**: ${totalTokens.toLocaleString()}`,
    `- **Estimated Compute Cost**: $${totalCost.toFixed(4)} USD`,
    "",
    "## Aggregated Tool Invocations",
    "",
    "| Tool | Invocations | Share |",
    "| :--- | :--- | :--- |",
  ];

  const sortedTools = Object.entries(aggregatedTools).sort((a, b) => b[1] - a[1]);
  for (const [name, count] of sortedTools) {
    const pct = totalTools > 0 ? ((count / totalTools) * 100).toFixed(1) : "0.0";
    lines.push(`| \`${name}\` | ${count} | ${pct}% |`);
  }

  lines.push(
    "",
    "## Session Breakdown",
    "",
    "| Title | Agent | ID | Turns | Tools | Est. Cost |",
    "| :--- | :--- | :--- | :--- | :--- | :--- |"
  );

  for (const t of traces) {
    lines.push(
      `| ${t.title} | ${t.agent} | \`${t.id.slice(0, 12)}\` | ${t.turns.length} | ${t.toolInvocations.length} | $${t.diagnostics.tokenEconomics.estimatedCostUsd.toFixed(4)} |`
    );
  }

  return lines.join("\n") + "\n";
}
