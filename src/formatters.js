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
  const { tokens, tokenEconomics, toolCallStats, toolErrorsCount } = trace.diagnostics;
  const userTurns = trace.turns.filter((t) => t.role === "user").length;
  const modelTurns = trace.turns.filter((t) => t.role === "assistant").length;

  const lines = [
    `Session Trace: ${trace.title} (${trace.id})`,
    `Agent: ${trace.agent} | Status: ${trace.status}`,
    `Turns: ${userTurns} user, ${modelTurns} assistant`,
    `Tool Invocations: ${trace.toolInvocations.length} (errors: ${toolErrorsCount})`,
    `Tokens: ${tokens.totalTokens.toLocaleString()} total (${tokens.uncachedInputTokens.toLocaleString()} uncached, ${tokens.cacheReadTokens.toLocaleString()} cached, ${tokens.outputTokens.toLocaleString()} output)`,
    `Estimated Cost: $${tokenEconomics.estimatedCostUsd}`,
  ];

  const toolEntries = Object.entries(toolCallStats).sort((a, b) => b[1] - a[1]);
  if (toolEntries.length > 0) {
    lines.push("", "Tools:");
    for (const [name, count] of toolEntries) {
      lines.push(`  - ${name}: ${count}`);
    }
  }

  return lines.join("\n");
}
