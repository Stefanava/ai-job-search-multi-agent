// Isolated, in-memory tool handlers used only by src/evalQuery.js (the
// per-query contract built for build-vs-buy-eval's comparison). These
// mirror shared/tools.js's handleToolCall in every way except where they
// persist: save_lead/save_draft write to in-memory arrays here, never to
// data/leads.json or data/drafts.json. Without this split, running the
// eval harness against fixture/comparison queries would mix eval output
// into Stefan's real job-search pipeline data - the exact mistake
// build-vs-buy-eval's own Variant B/C tools.js was already careful to
// avoid (see variants/b-single-agent/tools.js - "fresh in-memory tool
// state... so results from one fixed query never leak into another").
//
// createEvalTools() returns fresh state on every call, matching that same
// per-query isolation - one call per query in evalQuery.js's runQuery().

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { retrieveContext } from "../shared/retrieval.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXCLUDED_PATH = path.join(__dirname, "..", "..", "data", "excluded_companies.json");

function readExcluded() {
  try {
    return JSON.parse(fs.readFileSync(EXCLUDED_PATH, "utf-8"));
  } catch {
    return [];
  }
}

export function createEvalTools() {
  const leads = [];
  const drafts = [];

  async function handleToolCall(name, input) {
    switch (name) {
      case "list_excluded_companies":
        // Read-only, and deliberately the real file (not a fixture) - the
        // exclusion list is what keeps a real comparison run from
        // resurfacing companies already dealt with. Nothing about reading
        // it can pollute anything; only save_lead/save_draft write.
        return readExcluded();

      case "list_existing_leads":
        return leads;

      case "save_lead": {
        const lead = {
          ...input,
          status: input.type === "meetup" ? "pending_review" : "pending_screen",
          found_at: new Date().toISOString(),
        };
        leads.push(lead);
        return { saved: true, lead };
      }

      case "retrieve_context":
        return retrieveContext(input.query);

      case "save_draft": {
        const draft = { ...input, created_at: new Date().toISOString() };
        drafts.push(draft);
        return { saved: true, draft };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  return { handleToolCall, getLeads: () => leads, getDrafts: () => drafts };
}
