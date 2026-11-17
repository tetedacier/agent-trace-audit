export const DEFAULT_PRICING = {
  name: "gemini-flash-default",
  uncachedInputPerM: 0.75,
  cacheReadPerM: 0.075,
  outputPerM: 3.75,
};

/**
 * Compute Token Economics and tool statistics for a normalized Session Trace.
 */
export function computeDiagnostics(trace, pricing = DEFAULT_PRICING) {
  let promptTokens = 0;
  let cacheReadTokens = 0;
  let outputTokens = 0;

  for (const turn of trace.turns) {
    promptTokens += turn.tokens?.promptTokens || 0;
    cacheReadTokens += turn.tokens?.cacheReadTokens || 0;
    outputTokens += turn.tokens?.outputTokens || 0;
  }

  const uncachedInputTokens = Math.max(0, promptTokens - cacheReadTokens);
  const totalTokens = promptTokens + outputTokens;

  const uncachedCost = (uncachedInputTokens / 1_000_000) * pricing.uncachedInputPerM;
  const cachedCost = (cacheReadTokens / 1_000_000) * pricing.cacheReadPerM;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerM;
  const estimatedCostUsd = Number((uncachedCost + cachedCost + outputCost).toFixed(4));

  const toolCallStats = {};
  let errorFromInvocations = 0;
  for (const inv of trace.toolInvocations) {
    toolCallStats[inv.name] = (toolCallStats[inv.name] || 0) + 1;
    if (inv.isError) errorFromInvocations++;
  }

  const toolErrorsCount = Math.max(errorFromInvocations, trace._rawToolErrorsCount || 0);

  return {
    tokens: {
      promptTokens,
      cacheReadTokens,
      uncachedInputTokens,
      outputTokens,
      totalTokens,
    },
    tokenEconomics: {
      estimatedCostUsd,
      modelPricingUsed: pricing.name,
    },
    toolCallStats,
    toolErrorsCount,
  };
}
