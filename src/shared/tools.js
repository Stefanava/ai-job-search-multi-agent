// PRD Phase 0: the shared client-tool library. Client tools run locally and
// need a handler here (as opposed to "web_search", a SERVER tool Anthropic
// resolves before the response reaches us). Each agent picks the subset of
// toolDefinitions it actually needs (see agents/researcher.js and
// agents/writer.js) and passes them to the API; handleToolCall dispatches
// by name regardless of which agent called it.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { retrieveContext } from "./retrieval.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const LEADS_PATH = path.join(DATA_DIR, "leads.json");
const EXCLUDED_PATH = path.join(DATA_DIR, "excluded_companies.json");
const DRAFTS_PATH = path.join(DATA_DIR, "drafts.json");

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

export const toolDefinitions = [
  {
    name: "list_excluded_companies",
    description:
      "Return the list of companies already in the pipeline (applied, rejected, paused, or parked). " +
      "Always call this before saving a job lead, so you don't resurface a company already dealt with.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_existing_leads",
    description:
      "Return leads already saved from previous runs, so you don't save duplicates within or across runs.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "save_lead",
    description:
      "Save a new job lead or meetup lead to the local leads file. Only call this for leads that " +
      "passed the exclusion check and match the search criteria.",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["job", "meetup"] },
        name: {
          type: "string",
          description: "Company name (for a job lead) or event name (for a meetup)",
        },
        title_or_topic: {
          type: "string",
          description: "Role title (job) or event topic (meetup)",
        },
        location: { type: "string" },
        link: { type: "string" },
        note: {
          type: "string",
          description: "Why it matches, or any flags (e.g. 'visa/entity unclear - verify before applying')",
        },
      },
      required: ["type", "name", "link"],
    },
  },
  {
    name: "retrieve_context",
    description:
      "Search the candidate's CV and past cover letters for passages relevant to a query (e.g. a job's " +
      "key requirements, or the company's focus area). Returns the top-matching chunks so drafts can be " +
      "grounded in real experience instead of invented. Call this before drafting, not after.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for in the CV/cover-letter corpus" },
      },
      required: ["query"],
    },
  },
  {
    name: "save_draft",
    description: "Save a drafted outreach paragraph for a specific lead, for human review before use.",
    input_schema: {
      type: "object",
      properties: {
        lead_link: { type: "string", description: "The lead's `link` field, unchanged - identifies which lead this is for" },
        draft_text: { type: "string" },
        status: { type: "string", enum: ["pending_review"] },
      },
      required: ["lead_link", "draft_text", "status"],
    },
  },
];

export async function handleToolCall(name, input) {
  switch (name) {
    case "list_excluded_companies":
      return readJson(EXCLUDED_PATH, []);

    case "list_existing_leads":
      return readJson(LEADS_PATH, []);

    case "save_lead": {
      const leads = readJson(LEADS_PATH, []);
      // Every new lead starts as pending_screen and nothing moves it further
      // along than that except the Screener (-> pending_review) and a human
      // decision in the review step (-> approved_for_draft / rejected_by_human
      // / held_by_human). Meetups skip straight to pending_review with no
      // Screener verdict, since there's no CV-fit question for an event -
      // review.js still shows them so nothing is drafted or acted on without
      // a human seeing it.
      const lead = {
        ...input,
        status: input.type === "meetup" ? "pending_review" : "pending_screen",
        found_at: new Date().toISOString(),
      };
      leads.push(lead);
      writeJson(LEADS_PATH, leads);
      return { saved: true, lead };
    }

    case "retrieve_context":
      return retrieveContext(input.query);

    case "save_draft": {
      const drafts = readJson(DRAFTS_PATH, []);
      const draft = { ...input, created_at: new Date().toISOString() };
      drafts.push(draft);
      writeJson(DRAFTS_PATH, drafts);
      return { saved: true, draft };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// Not Claude tools - plain helpers used by scan.js/review.js/draft.js to move
// a lead through pending_screen -> pending_review -> approved_for_draft /
// rejected_by_human / held_by_human. Leads are keyed by `link` (unchanged
// from how save_draft already correlates a draft back to its lead), not a
// separate id field, to avoid introducing a second identifier scheme.

export function getAllLeads() {
  return readJson(LEADS_PATH, []);
}

export function getLeadsByStatus(status) {
  return readJson(LEADS_PATH, []).filter((l) => l.status === status);
}

export function updateLeadStatus(leadLink, status, extra = {}) {
  const leads = readJson(LEADS_PATH, []);
  const lead = leads.find((l) => l.link === leadLink);
  if (!lead) return null;
  Object.assign(lead, extra, { status });
  writeJson(LEADS_PATH, leads);
  return lead;
}
