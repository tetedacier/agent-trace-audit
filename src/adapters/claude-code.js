import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { collectJsonlFiles, emptyTokens, parseJsonlFile, summarizeText } from "./shared.js";

function resolveClaudeProjectsDir(dataDir) {
  const base = dataDir || process.env.AGENT_TRACE_AUDIT_DATA_DIR;
  if (base) {
    const nested = join(base, "claude", "projects");
    if (existsSync(nested)) return nested;
    const directProjects = join(base, "projects");
    if (existsSync(directProjects)) return directProjects;
    return null;
  }
  if (process.env.AGENT_TRACE_AUDIT_CLAUDE_DIR) {
    return process.env.AGENT_TRACE_AUDIT_CLAUDE_DIR;
  }
  return join(homedir(), ".claude", "projects");
}

function extractUserText(content) {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text)
      .join(" ")
      .trim();
  }
  return "";
}

function summarizeInput(input) {
  if (!input || typeof input !== "object") return "";
  if (input.command) return String(input.command);
  if (input.file_path) return String(input.file_path);
  if (input.path) return String(input.path);
  return JSON.stringify(input).slice(0, 120);
}

/**
 * Create a Trace Adapter for local Claude Code JSONL session logs.
 */
export function createClaudeCodeAdapter(dataDir) {
  const projectsDir = resolveClaudeProjectsDir(dataDir);
  const pathById = new Map();

  function parseFile(filePath) {
    const fallbackId = basename(filePath, ".jsonl");
    const parsed = parseJsonlFile(filePath, fallbackId);
    const turns = [];
    const toolInvocations = [];
    const toolByUseId = new Map();

    let id = fallbackId;
    let workspace = null;
    let startedAt = null;
    let lastModifiedAt = null;
    let title = null;

    for (const item of parsed.items) {
      if (item.sessionId) id = item.sessionId;
      if (item.cwd && !workspace) workspace = item.cwd;
      if (item.timestamp) {
        if (!startedAt) startedAt = item.timestamp;
        lastModifiedAt = item.timestamp;
      }

      const role = item.message?.role || item.type;
      const content = item.message?.content;

      if (role === "user") {
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "tool_result" && block.tool_use_id && block.is_error) {
              const inv = toolByUseId.get(block.tool_use_id);
              if (inv) inv.isError = true;
            }
          }
        }
        const text = extractUserText(content);
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
      } else if (role === "assistant") {
        const turnIndex = turns.length + 1;
        const usage = item.message?.usage || {};
        const cacheReadTokens = usage.cache_read_input_tokens || 0;
        const uncached = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
        const promptTokens = uncached + cacheReadTokens;
        const outputTokens = usage.output_tokens || 0;

        const turnCalls = [];
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "tool_use") {
              const input = block.input || {};
              const inv = {
                turnIndex,
                timestamp: item.timestamp || null,
                name: block.name || "unknown",
                summary: summarizeInput(input),
                command: input.command ? String(input.command) : null,
                isError: false,
              };
              turnCalls.push(inv);
              toolInvocations.push(inv);
              if (block.id) toolByUseId.set(block.id, inv);
            }
          }
        }

        turns.push({
          index: turnIndex,
          role: "assistant",
          timestamp: item.timestamp || null,
          tokens: { promptTokens, cacheReadTokens, outputTokens },
          toolInvocations: turnCalls,
        });
      }
    }

    if (!lastModifiedAt) {
      lastModifiedAt = statSync(filePath).mtime.toISOString();
    }

    pathById.set(id, filePath);

    return {
      id,
      agent: "claude-code",
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
    name: "claude-code",

    list() {
      const files = collectJsonlFiles(projectsDir);
      return files.map((filePath) => {
        const trace = parseFile(filePath);
        return {
          id: trace.id,
          agent: "claude-code",
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
