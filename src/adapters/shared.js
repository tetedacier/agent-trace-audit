import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function emptyTokens() {
  return { promptTokens: 0, cacheReadTokens: 0, outputTokens: 0 };
}

export function summarizeText(text, maxLen = 160) {
  const clean = (text || "").trim();
  return clean.slice(0, maxLen) + (clean.length > maxLen ? "..." : "");
}

export function collectJsonlFiles(dir, out = []) {
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

export function parseJsonlFile(filePath, sessionId) {
  const lines = readFileSync(filePath, "utf8").split("\n").filter(Boolean);
  const items = [];
  const warnings = [];

  for (let i = 0; i < lines.length; i++) {
    try {
      items.push(JSON.parse(lines[i]));
    } catch {
      warnings.push(`Skipped malformed JSONL at line ${i + 1} in ${sessionId}`);
    }
  }
  return { items, warnings };
}
