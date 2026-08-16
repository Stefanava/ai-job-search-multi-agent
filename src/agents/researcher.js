// PRD Phase 1: the Researcher agent - the existing ai-job-search-agent loop,
// unchanged in behavior, just wired through the shared runToolLoop instead
// of carrying its own copy of the loop.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { toolDefinitions, handleToolCall } from "../shared/tools.js";
import { runToolLoop } from "../shared/claude.js";
import { logEvent } from "../shared/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const criteria = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "config", "criteria.json"), "utf-8")
);

const SYSTEM_PROMPT = `You are a job search research assistant for a UK-based Engineering Manager who is open to
relocating within Europe. The search focuses on remote and relocation-friendly roles.

Hard constraint, not a preference: the candidate must be able to work in the role's location.
Remote roles must be open to candidates based in the UK or Europe. Roles tied to a European
office need relocation support, visa sponsorship, or a clear sign the company hires from the UK.
If a listing doesn't make location eligibility clear, still surface it but flag it explicitly
(e.g. "location eligibility unclear - verify before applying"). Never silently drop it and
never silently include it as if it were confirmed.

Search criteria (edit config/criteria.json to change this without touching code):
${JSON.stringify(criteria, null, 2)}

Workflow:
1. Call list_excluded_companies and list_existing_leads first, so you know what to skip.
2. Use web_search to look for new Engineering Manager (or equivalent) roles on the configured
   job sources, and new meetups on the configured meetup sources/locations/topics.
3. For each genuinely new match that fits the criteria and isn't already excluded or already
   saved, call save_lead.
4. Finish with a short plain-text summary: how many job leads and meetups you saved, and
   anything that needs a human judgement call (e.g. the location eligibility flag).

Be honest about zero results. Do not pad the list with weak matches just to have something to report.`;

const researcherToolDefs = toolDefinitions.filter((t) =>
  ["list_excluded_companies", "list_existing_leads", "save_lead"].includes(t.name)
);

const tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 15 }, ...researcherToolDefs];

export async function runResearcher(userPrompt) {
  const savedLeads = [];
  const wrappedHandler = async (name, input) => {
    const result = await handleToolCall(name, input);
    if (name === "save_lead" && result?.saved) savedLeads.push(result.lead);
    return result;
  };

  const { finalResponse } = await runToolLoop({
    agentName: "researcher",
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    tools,
    handleToolCall: wrappedHandler,
    onLog: logEvent,
  });

  const summary = finalResponse?.content.find((b) => b.type === "text")?.text?.trim() || "";
  return { newLeads: savedLeads, summary };
}
