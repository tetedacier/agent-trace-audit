export const DEFAULT_PRICING = {
  name: "gemini-flash-default",
  uncachedInputPerM: 0.75,
  cacheReadPerM: 0.075,
  outputPerM: 3.75,
};

const THRASH_THRESHOLD = 3;
const LOW_CACHE_RATIO_THRESHOLD = 0.2;
const NON_TRIVIAL_PROMPT_TOKENS = 10_000;

function detectThrashLoops(toolInvocations) {
  const loops = [];
  let i = 0;

  while (i < toolInvocations.length) {
    const start = toolInvocations[i];
    const startKey = `${start.name}::${start.summary}`;
    let j = i + 1;

    while (j < toolInvocations.length) {
      const curr = toolInvocations[j];
      const sameCall = `${curr.name}::${curr.summary}` === startKey;
      const consecutiveFailures = start.isError && curr.isError && curr.name === start.name;
      if (!sameCall && !consecutiveFailures) break;
      j++;
    }

    const count = j - i;
    if (count >= THRASH_THRESHOLD) {
      const allErrors = toolInvocations.slice(i, j).every((inv) => inv.isError);
      loops.push({
        toolName: start.name,
        summary: start.summary,
        count,
        startTurn: start.turnIndex,
        endTurn: toolInvocations[j - 1].turnIndex,
        reason: allErrors ? "consecutive-failing-invocations" : "consecutive-identical-invocations",
      });
    }
    i = j;
  }

  return loops;
}

function computeCacheEfficiency(promptTokens, cacheReadTokens) {
  if (promptTokens <= 0) {
    return { hitRatio: 0, warning: null };
  }
  const hitRatio = Number((cacheReadTokens / promptTokens).toFixed(4));
  const warning =
    promptTokens >= NON_TRIVIAL_PROMPT_TOKENS && hitRatio < LOW_CACHE_RATIO_THRESHOLD
      ? `Low Cache Efficiency (${(hitRatio * 100).toFixed(1)}% across ${promptTokens.toLocaleString()} prompt tokens)`
      : null;
  return { hitRatio, warning };
}

function computeTopTokenTurns(turns, limit = 5) {
  return turns
    .filter((t) => (t.tokens?.promptTokens || 0) + (t.tokens?.outputTokens || 0) > 0)
    .map((t) => ({
      index: t.index,
      promptTokens: t.tokens.promptTokens || 0,
      cacheReadTokens: t.tokens.cacheReadTokens || 0,
      outputTokens: t.tokens.outputTokens || 0,
      totalTokens: (t.tokens.promptTokens || 0) + (t.tokens.outputTokens || 0),
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, limit);
}

/**
 * Compute Token Economics, Cache Efficiency, Thrash Loops, and tool statistics for a Session Trace.
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
    cacheEfficiency: computeCacheEfficiency(promptTokens, cacheReadTokens),
    thrashLoops: detectThrashLoops(trace.toolInvocations),
    topTokenTurns: computeTopTokenTurns(trace.turns),
    toolCallStats,
    toolErrorsCount,
  };
}
