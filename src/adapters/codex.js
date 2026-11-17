import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

function resolveCodexSessionsDir(dataDir) {
  if (dataDir) {
    const nested = join(dataDir, "codex", "sessions");
    if (existsSync(nested)) return nested;
    const directSessions = join(dataDir, "sessions");
    if (existsSync(directSessions)) return directSessions;
    return null;
  }
  if (process.env.AGENT_TRACE_AUDIT_CODEX_DIR) {
    return process.env.AGENT_TRACE_AUDIT_CODEX_DIR;
  }
  return join(homedir(), ".codex", "sessions");
}

function collectJsonlFiles(dir, out = []) {
  if (!dir || !existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectJsonlFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      out.push(full);
    }
  }
  return out;
}

function extractInputText(content) {
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

  function parseFile(filePath) {
    const fallbackId = basename(filePath, ".jsonl");
    const lines = readFileSync(filePath, "utf8").split("\n").filter(Boolean);
    const turns = [];
    const toolInvocations = [];
    const callById = new Map();
    const warnings = [];

    let id = fallbackId;
    let workspace = null;
    let startedAt = null;
    let lastModifiedAt = null;
    let title = null;

    for (let i = 0; i < lines.length; i++) {
      let item;
      try {
        item = JSON.parse(lines[i]);
      } catch {
        warnings.push(`Skipped malformed JSONL at line ${i + 1} in ${fallbackId}`);
        continue;
      }

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
          const text = extractInputText(payload.content);
          if (text) {
            if (!title) title = text.slice(0, 80);
            turns.push({
              index: turns.length + 1,
              role: "user",
              timestamp: item.timestamp || null,
              summary: text.slice(0, 160) + (text.length > 160 ? "..." : ""),
              tokens: { promptTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
              toolInvocations: [],
            });
          }
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
            tokens: { promptTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
            toolInvocations: [inv],
          });
        } else if (payload.type === "function_call_output" && payload.call_id) {
          const inv = callById.get(payload.call_id);
          if (inv && isErrorOutput(payload.output)) {
            inv.isError = true;
          }
        }
      } else if (item.type === "event_msg" && payload.type === "token_count") {
        const usage = payload.info?.last_token_usage || payload.info?.total_token_usage;
        if (usage) {
          turns.push({
            index: turns.length + 1,
            role: "assistant",
            timestamp: item.timestamp || null,
            tokens: {
              promptTokens: usage.input_tokens || 0,
              cacheReadTokens: usage.cached_input_tokens || 0,
              outputTokens: usage.output_tokens || 0,
            },
            toolInvocations: [],
          });
        }
      }
    }

    if (!lastModifiedAt) {
      lastModifiedAt = statSync(filePath).mtime.toISOString();
    }

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
      warnings,
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
          stepCount: trace.turns.length,
          workspaces: trace.workspace ? [trace.workspace] : [],
          lastModifiedAt: trace.lastModifiedAt,
          _filePath: filePath,
        };
      });
    },

    load(sessionId) {
      const match = this.list().find((s) => s.id === sessionId);
      if (!match) return null;
      return parseFile(match._filePath);
    },
  };
}
