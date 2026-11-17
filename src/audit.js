import { createAntigravityAdapter } from "./adapters/antigravity.js";
import { createClaudeCodeAdapter } from "./adapters/claude-code.js";
import { createCodexAdapter } from "./adapters/codex.js";
import { computeDiagnostics, DEFAULT_PRICING } from "./diagnostics.js";

/**
 * Create the top-level audit pipeline over configured Trace Adapters.
 */
export function createAuditor(options = {}) {
  const adapters = options.adapters || [
    createAntigravityAdapter(options.dataDir),
    createClaudeCodeAdapter(options.dataDir),
    createCodexAdapter(options.dataDir),
  ];
  const pricing = options.pricing || DEFAULT_PRICING;

  return {
    listSessions(filter = {}) {
      const all = adapters.flatMap((adapter) => adapter.list());
      const filtered = filter.agent ? all.filter((s) => s.agent === filter.agent) : all;
      return filtered.map(({ _filePath, ...rest }) => rest);
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
    auditAllSessions(filter = {}) {
      const sessions = this.listSessions(filter);
      const traces = [];
      for (const s of sessions) {
        try {
          traces.push(this.auditSession(s.id));
        } catch {
          // Skip unreadable sessions during portfolio scan
        }
      }
      return traces;
    },
  };
}
