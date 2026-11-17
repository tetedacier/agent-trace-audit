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

    resolveSession(idOrPrefix) {
      const sessions = this.listSessions();
      const exact = sessions.find((s) => s.id === idOrPrefix);
      if (exact) return exact;

      const matches = sessions.filter((s) => s.id.startsWith(idOrPrefix));
      if (matches.length === 1) return matches[0];
      if (matches.length > 1) {
        const candidates = matches.map((m) => `  - ${m.id} (${m.agent})`).join("\n");
        throw new Error(`Ambiguous Session Trace prefix "${idOrPrefix}". Matches:\n${candidates}`);
      }
      throw new Error(`Session Trace "${idOrPrefix}" not found.`);
    },

    auditSession(idOrPrefix) {
      const resolved = this.resolveSession(idOrPrefix);
      for (const adapter of adapters) {
        if (adapter.name !== resolved.agent) continue;
        const raw = adapter.load(resolved.id);
        if (raw) {
          const { _rawToolErrorsCount, ...trace } = raw;
          return {
            ...trace,
            warnings: trace.warnings || [],
            diagnostics: computeDiagnostics(raw, pricing),
          };
        }
      }
      throw new Error(`Session Trace "${idOrPrefix}" not found.`);
    },
  };
}
