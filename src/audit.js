import { createAntigravityAdapter } from "./adapters/antigravity.js";
import { computeDiagnostics, DEFAULT_PRICING } from "./diagnostics.js";

/**
 * Create the top-level audit pipeline over configured Trace Adapters.
 */
export function createAuditor(options = {}) {
  const adapters = options.adapters || [createAntigravityAdapter(options.dataDir)];
  const pricing = options.pricing || DEFAULT_PRICING;

  return {
    listSessions() {
      return adapters.flatMap((adapter) => adapter.list());
    },

    auditSession(sessionId) {
      for (const adapter of adapters) {
        const raw = adapter.load(sessionId);
        if (raw) {
          const { _rawToolErrorsCount, ...trace } = raw;
          return {
            ...trace,
            diagnostics: computeDiagnostics(raw, pricing),
          };
        }
      }
      throw new Error(`Session Trace "${sessionId}" not found.`);
    },
  };
}
