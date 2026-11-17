export const DEFAULT_PRICING = {
  name: "gemini-flash-default",
  uncachedInputPerM: 0.75,
  cacheReadPerM: 0.075,
  outputPerM: 3.75,
};

const THRASH_THRESHOLD = 3;
const LOW_CACHE_RATIO_THRESHOLD = 0.2;
const NON_TRIVIAL_PROMPT_TOKENS = 10_000;

export function validatePricing(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid pricing configuration: expected a JSON object.");
  }
  for (const field of ["uncachedInputPerM", "cacheReadPerM", "outputPerM"]) {
    if (typeof raw[field] !== "number" || Number.isNaN(raw[field]) || raw[field] < 0) {
      throw new Error(`Invalid pricing configuration: "${field}" must be a non-negative number.`);
    }
  }
  return {
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "custom-pricing",
    uncachedInputPerM: raw.uncachedInputPerM,
    cacheReadPerM: raw.cacheReadPerM,
    outputPerM: raw.outputPerM,
  };
}

function findRun(toolInvocations, startIndex, predicate) {
  let j = startIndex + 1;
  while (j < toolInvocations.length && predicate(toolInvocations[j])) {
    j++;
  }
  return j;
}

function detectThrashLoops(toolInvocations) {
  const loops = [];
  let i = 0;

  while (i < toolInvocations.length) {
    const start = toolInvocations[i];
    const startKey = `${start.name}::${start.summary}`;

    if (start.isError) {
      const failEnd = findRun(toolInvocations, i, (c) => c.isError && c.name === start.name);
      if (failEnd - i >= THRASH_THRESHOLD) {
        loops.push({
          toolName: start.name,
          summary: start.summary,
          count: failEnd - i,
          startTurn: start.turnIndex,
          endTurn: toolInvocations[failEnd - 1].turnIndex,
          reason: "consecutive-failing-invocations",
        });
        i = failEnd;
        continue;
      }
    }

    const sameEnd = findRun(toolInvocations, i, (c) => `${c.name}::${c.summary}` === startKey);
    if (sameEnd - i >= THRASH_THRESHOLD) {
      loops.push({
        toolName: start.name,
        summary: start.summary,
        count: sameEnd - i,
        startTurn: start.turnIndex,
        endTurn: toolInvocations[sameEnd - 1].turnIndex,
        reason: "consecutive-identical-invocations",
      });
      i = sameEnd;
      continue;
    }

    i++;
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

  const toolErrorsCount = Math.max(errorFromInvocations, trace.toolErrorsCount || 0);

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
