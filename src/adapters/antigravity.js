import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function resolveAntigravityRoot(dataDir) {
  return dataDir || process.env.AGENT_TRACE_AUDIT_DATA_DIR || join(homedir(), ".gemini/antigravity-cli");
}

function parseWorkspaces(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [raw];
  } catch {
    return [raw];
  }
}

function cleanUserPrompt(content) {
  return (content || "")
    .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, "")
    .replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/g, "")
    .replace(/<\/?USER_REQUEST>/g, "")
    .trim();
}

function summarizeToolArgs(name, args) {
  if (!args || typeof args !== "object") return "";
  if (args.CommandLine) return String(args.CommandLine);
  if (args.Path) return String(args.Path);
  return JSON.stringify(args).slice(0, 120);
}

/**
 * Create a Trace Adapter for local Antigravity CLI session logs.
 */
export function createAntigravityAdapter(dataDir) {
  const root = resolveAntigravityRoot(dataDir);
  const summariesDbPath = join(root, "conversation_summaries.db");
  const brainDir = join(root, "brain");

  function openDb() {
    if (!existsSync(summariesDbPath)) {
      return null;
    }
    return new DatabaseSync(summariesDbPath, { readOnly: true });
  }

  return {
    name: "antigravity",

    list() {
      const db = openDb();
      if (!db) return [];
      try {
        const rows = db.prepare(`
          SELECT conversation_id, title, last_modified_time, step_count, workspace_uris, status
          FROM conversation_summaries
          ORDER BY last_modified_time ASC
        `).all();
        return rows.map((row) => ({
          id: row.conversation_id,
          agent: "antigravity",
          title: row.title || "Untitled Session",
          status: row.status || "UNKNOWN",
          stepCount: row.step_count || 0,
          workspaces: parseWorkspaces(row.workspace_uris),
          lastModifiedAt: row.last_modified_time || null,
        }));
      } finally {
        db.close();
      }
    },

    load(sessionId) {
      const db = openDb();
      if (!db) return null;
      let meta;
      try {
        meta = db
          .prepare("SELECT * FROM conversation_summaries WHERE conversation_id = ?")
          .get(sessionId);
      } finally {
        db.close();
      }
      if (!meta) return null;

      const transcriptPath = join(brainDir, sessionId, ".system_generated", "logs", "transcript.jsonl");
      const turns = [];
      const toolInvocations = [];
      let startedAt = null;
      let lastModifiedAt = meta.last_modified_time || null;
      let toolErrorsCount = 0;

      if (existsSync(transcriptPath)) {
        const lines = readFileSync(transcriptPath, "utf8").split("\n").filter(Boolean);
        for (const line of lines) {
          const item = JSON.parse(line);
          if (!startedAt && item.created_at) startedAt = item.created_at;
          if (item.created_at) lastModifiedAt = item.created_at;

          if (item.type === "USER_INPUT") {
            const text = cleanUserPrompt(item.content);
            turns.push({
              index: turns.length + 1,
              role: "user",
              timestamp: item.created_at || null,
              summary: text.slice(0, 160) + (text.length > 160 ? "..." : ""),
              tokens: { promptTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
              toolInvocations: [],
            });
          } else if (item.type === "PLANNER_RESPONSE") {
            const turnIndex = turns.length + 1;
            const turnCalls = [];
            if (Array.isArray(item.tool_calls)) {
              for (const call of item.tool_calls) {
                const name = call.name || call.function?.name || "unknown";
                const args = call.arguments || call.function?.arguments || {};
                const inv = {
                  turnIndex,
                  timestamp: item.created_at || null,
                  name,
                  summary: summarizeToolArgs(name, args),
                  command: args.CommandLine ? String(args.CommandLine) : null,
                  isError: false,
                };
                turnCalls.push(inv);
                toolInvocations.push(inv);
              }
            }
            turns.push({
              index: turnIndex,
              role: "assistant",
              timestamp: item.created_at || null,
              tokens: {
                promptTokens: item.input_tokens || 0,
                cacheReadTokens: item.cache_read_tokens || 0,
                outputTokens: item.output_tokens || 0,
              },
              toolInvocations: turnCalls,
            });
          }

          if (item.status === "ERROR") {
            toolErrorsCount++;
            if (toolInvocations.length > 0) {
              toolInvocations[toolInvocations.length - 1].isError = true;
            }
          }
        }
      }

      return {
        id: sessionId,
        agent: "antigravity",
        title: meta.title || "Untitled Session",
        status: meta.status || "UNKNOWN",
        workspace: parseWorkspaces(meta.workspace_uris)[0] || null,
        startedAt,
        lastModifiedAt,
        turns,
        toolInvocations,
        _rawToolErrorsCount: toolErrorsCount,
      };
    },
  };
}
