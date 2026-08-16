// Per-agent run logging (PRD Phase 5): every model call any agent makes -
// tool calls, tokens, cost, latency - appended as one JSON line per call to
// data/run_log.jsonl. Gitignored: this is real usage data, not fixtures.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_PATH = path.join(__dirname, "..", "..", "data", "run_log.jsonl");

// $ per million tokens. These drift - check platform.claude.com/docs/en/pricing
// before trusting this for anything beyond a rough per-run estimate.
const PRICING = {
  "claude-sonnet-5": { input: 3, output: 15 },
};

export function logEvent(event) {
  const price = PRICING[event.model] || { input: 0, output: 0 };
  const costUsd =
    (event.input_tokens / 1_000_000) * price.input + (event.output_tokens / 1_000_000) * price.output;

  const line = {
    timestamp: new Date().toISOString(),
    ...event,
    cost_usd: Number(costUsd.toFixed(6)),
  };

  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.appendFileSync(LOG_PATH, JSON.stringify(line) + "\n");
}

// Summarizes logged calls at/after `sinceIso` (an ISO timestamp) - pass the
// current run's start time to scope this to "what did this run cost", per
// the PRD's cost-per-completed-draft success criterion. Omit it for an
// all-time total across every run this log has ever recorded.
export function summarizeRunLog(sinceIso = null) {
  if (!fs.existsSync(LOG_PATH)) return { calls: 0, totalCostUsd: 0 };
  const lines = fs.readFileSync(LOG_PATH, "utf-8").trim().split("\n").filter(Boolean);
  const events = lines.map((l) => JSON.parse(l)).filter((e) => !sinceIso || e.timestamp >= sinceIso);
  const totalCostUsd = events.reduce((sum, e) => sum + (e.cost_usd || 0), 0);
  return { calls: events.length, totalCostUsd: Number(totalCostUsd.toFixed(4)) };
}
