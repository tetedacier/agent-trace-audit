import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { collectJsonlFiles, emptyTokens, parseJsonlFile, summarizeText } from "./shared.js";

function resolveCodexSessionsDir(dataDir) {
  const base = dataDir || process.env.AGENT_TRACE_AUDIT_DATA_DIR;
  if (base) {
    const nested = join(base, "codex", "sessions");
    if (existsSync(nested)) return nested;
    const directSessions = join(base, "sessions");
    if (existsSync(directSessions)) return directSessions;
    return null;
  }
  if (process.env.AGENT_TRACE_AUDIT_CODEX_DIR) {
    return process.env.AGENT_TRACE_AUDIT_CODEX_DIR;
  }
  return join(homedir(), ".codex", "sessions");
}

function extractText(content) {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .filter((b) => b.text)
      .map((b) => b.text)
      .join(" ")
      .trim();
  }
  return "";
}

function parseArguments(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return { raw: String(raw) };
  }
}

function isErrorOutput(outputRaw) {
  if (!outputRaw) return false;
  try {
    const parsed = typeof outputRaw === "string" ? JSON.parse(outputRaw) : outputRaw;
    if (parsed?.metadata?.exit_code !== undefined) {
      return Number(parsed.metadata.exit_code) !== 0;
    }
  } catch {
    // Fallback to text heuristic
  }
  return /exit code [1-9]/i.test(String(outputRaw));
}

/**
 * Create a Trace Adapter for local Codex CLI rollout JSONL session logs.
 */
export function createCodexAdapter(dataDir) {
  const sessionsDir = resolveCodexSessionsDir(dataDir);
  const pathById = new Map();

  function parseFile(filePath) {
    const fallbackId = basename(filePath, ".jsonl");
    const parsed = parseJsonlFile(filePath, fallbackId);
    const turns = [];
    const toolInvocations = [];
    const callById = new Map();

    let id = fallbackId;
    let workspace = null;
    let startedAt = null;
    let lastModifiedAt = null;
    let title = null;
    let sawLastTokenUsage = false;
    let latestTotalUsage = null;

    for (const item of parsed.items) {
      if (item.timestamp) {
        if (!startedAt) startedAt = item.timestamp;
        lastModifiedAt = item.timestamp;
      }

      const payload = item.payload || {};

      if (item.type === "session_meta") {
        if (payload.id) id = payload.id;
        if (payload.cwd) workspace = payload.cwd;
        if (payload.timestamp && !startedAt) startedAt = payload.timestamp;
        continue;
      }

      if (item.type === "response_item") {
        if (payload.type === "message" && payload.role === "user") {
          const text = extractText(payload.content);
          if (text) {
            if (!title) title = text.slice(0, 80);
            turns.push({
              index: turns.length + 1,
              role: "user",
              timestamp: item.timestamp || null,
              summary: summarizeText(text),
              tokens: emptyTokens(),
              toolInvocations: [],
            });
          }
        } else if (payload.type === "message" && payload.role === "assistant") {
          turns.push({
            index: turns.length + 1,
            role: "assistant",
            timestamp: item.timestamp || null,
            tokens: emptyTokens(),
            toolInvocations: [],
          });
        } else if (payload.type === "function_call") {
          const args = parseArguments(payload.arguments);
          const command = args.command
            ? Array.isArray(args.command)
              ? args.command.join(" ")
              : String(args.command)
            : null;
          const turnIndex = turns.length + 1;
          const inv = {
            turnIndex,
            timestamp: item.timestamp || null,
            name: payload.name || "unknown",
            summary: command || JSON.stringify(args).slice(0, 120),
            command,
            isError: false,
          };
          toolInvocations.push(inv);
          if (payload.call_id) callById.set(payload.call_id, inv);
          turns.push({
            index: turnIndex,
            role: "assistant",
            timestamp: item.timestamp || null,
            tokens: emptyTokens(),
            toolInvocations: [inv],
          });
        } else if (payload.type === "function_call_output" && payload.call_id) {
          const inv = callById.get(payload.call_id);
          if (inv && isErrorOutput(payload.output)) {
            inv.isError = true;
          }
        }
      } else if (item.type === "event_msg" && payload.type === "token_count") {
        const lastUsage = payload.info?.last_token_usage;
        if (lastUsage) {
          sawLastTokenUsage = true;
          const targetTurn = [...turns].reverse().find((t) => t.role === "assistant");
          const usageTokens = {
            promptTokens: lastUsage.input_tokens || 0,
            cacheReadTokens: lastUsage.cached_input_tokens || 0,
            outputTokens: lastUsage.output_tokens || 0,
          };
          if (targetTurn) {
            targetTurn.tokens.promptTokens += usageTokens.promptTokens;
            targetTurn.tokens.cacheReadTokens += usageTokens.cacheReadTokens;
            targetTurn.tokens.outputTokens += usageTokens.outputTokens;
          } else {
            turns.push({
              index: turns.length + 1,
              role: "assistant",
              timestamp: item.timestamp || null,
              tokens: usageTokens,
              toolInvocations: [],
            });
          }
        } else if (payload.info?.total_token_usage) {
          latestTotalUsage = payload.info.total_token_usage;
        }
      }
    }

    if (!sawLastTokenUsage && latestTotalUsage) {
      const targetTurn = [...turns].reverse().find((t) => t.role === "assistant");
      const usageTokens = {
        promptTokens: latestTotalUsage.input_tokens || 0,
        cacheReadTokens: latestTotalUsage.cached_input_tokens || 0,
        outputTokens: latestTotalUsage.output_tokens || 0,
      };
      if (targetTurn) {
        targetTurn.tokens = usageTokens;
      } else {
        turns.push({
          index: turns.length + 1,
          role: "assistant",
          timestamp: lastModifiedAt,
          tokens: usageTokens,
          toolInvocations: [],
        });
      }
    }

    if (!lastModifiedAt) {
      lastModifiedAt = statSync(filePath).mtime.toISOString();
    }

    pathById.set(id, filePath);

    return {
      id,
      agent: "codex",
      title: title || id,
      status: "RECORDED",
      workspace,
      startedAt,
      lastModifiedAt,
      turns,
      toolInvocations,
      warnings: parsed.warnings,
    };
  }

  return {
    name: "codex",

    list() {
      const files = collectJsonlFiles(sessionsDir);
      return files.map((filePath) => {
        const trace = parseFile(filePath);
        return {
          id: trace.id,
          agent: "codex",
          title: trace.title,
          status: trace.status,
          turnCount: trace.turns.length,
          workspaces: trace.workspace ? [trace.workspace] : [],
          lastModifiedAt: trace.lastModifiedAt,
        };
      });
    },

    load(sessionId) {
      let filePath = pathById.get(sessionId);
      if (!filePath) {
        this.list();
        filePath = pathById.get(sessionId);
      }
      return filePath ? parseFile(filePath) : null;
    },
  };
}
