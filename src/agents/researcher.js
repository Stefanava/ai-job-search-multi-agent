// PRD Phase 1: the Researcher agent - the existing ai-job-search-agent loop,
// unchanged in behavior, just wired through the shared runToolLoop instead
// of carrying its own copy of the loop.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { toolDefinitions, handleToolCall as defaultHandleToolCall } from "../shared/tools.js";
import { runToolLoop } from "../shared/claude.js";
import { logEvent } from "../shared/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const criteria = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "config", "criteria.json"), "utf-8")
);

// jobsOnly is a hard prompt change, not a soft instruction layered on top of
// the default prompt - it removes the meetup step and criteria entirely
// rather than asking the model to ignore something it's still been told to
// do. Built for the build-vs-buy comparison, where Variants B/C only ever
// answer job queries - running this system in the same jobs-only scope
// makes that comparison apples-to-apples instead of penalizing Variant D
// for doing more than it was asked to be scored on.
function buildSystemPrompt({ jobsOnly }) {
  const { meetup_sources, meetup_locations, meetup_topics, ...jobCriteria } = criteria;
  const activeCriteria = jobsOnly ? jobCriteria : criteria;

  const searchStep = jobsOnly
    ? "2. Use web_search to look for new Engineering Manager (or equivalent) roles on the configured job sources."
    : "2. Use web_search to look for new Engineering Manager (or equivalent) roles on the configured\n   job sources, and new meetups on the configured meetup sources/locations/topics.";

  const summaryStep = jobsOnly
    ? "4. Finish with a short plain-text summary: how many job leads you saved, and anything that needs\n   a human judgement call (e.g. the visa/entity flag)."
    : "4. Finish with a short plain-text summary: how many job leads and meetups you saved, and\n   anything that needs a human judgement call (e.g. the visa/entity flag).";

  return `You are a job search research assistant for an Engineering Manager who is
planning a relocation to Barcelona under Spain's Digital Nomad Visa.

Hard constraint, not a preference: the Digital Nomad Visa requires a NON-SPANISH employer.
Any Barcelona-based role where the person would be employed via a Spanish legal entity breaks
visa eligibility outright. If a listing doesn't make the employing entity clear, still surface
it but flag it explicitly (e.g. "visa/entity unclear - verify before applying"). Never silently
drop it and never silently include it as if it were confirmed safe.
${jobsOnly ? "\nThis run is scoped to job leads only. Do not search meetup sources, do not save meetup leads, even if criteria elsewhere would otherwise cover them.\n" : ""}
Search criteria (edit config/criteria.json to change this without touching code):
${JSON.stringify(activeCriteria, null, 2)}

Workflow:
1. Call list_excluded_companies and list_existing_leads first, so you know what to skip.
${searchStep}
3. For each genuinely new match that fits the criteria and isn't already excluded or already
   saved, call save_lead.
${summaryStep}

Be honest about zero results. Do not pad the list with weak matches just to have something to report.`;
}

const researcherToolDefs = toolDefinitions.filter((t) =>
  ["list_excluded_companies", "list_existing_leads", "save_lead"].includes(t.name)
);

const tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 15 }, ...researcherToolDefs];

// handleToolCall is overridable so src/evalQuery.js can run the Researcher
// against isolated, in-memory tool state (src/eval/evalTools.js) instead of
// the real data/leads.json - real usage (src/scan.js) never passes this and
// gets the real, disk-backed handler by default.
export async function runResearcher(userPrompt, { jobsOnly = false, handleToolCall: customHandleToolCall } = {}) {
  const baseHandleToolCall = customHandleToolCall || defaultHandleToolCall;
  const savedLeads = [];
  const wrappedHandler = async (name, input) => {
    const result = await baseHandleToolCall(name, input);
    if (name === "save_lead" && result?.saved) savedLeads.push(result.lead);
    return result;
  };

  const { finalResponse } = await runToolLoop({
    agentName: "researcher",
    systemPrompt: buildSystemPrompt({ jobsOnly }),
    userPrompt,
    tools,
    handleToolCall: wrappedHandler,
    onLog: logEvent,
  });

  const summary = finalResponse?.content.find((b) => b.type === "text")?.text?.trim() || "";
  return { newLeads: savedLeads, summary };
}
