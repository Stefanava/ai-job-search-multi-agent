// PRD Phase 3: the Writer agent - given a specific lead, retrieves relevant
// CV/cover-letter context and drafts a tailored outreach paragraph. Never
// touches leads.json/excluded_companies.json directly - it only sees the
// one lead the Orchestrator hands it.

import { toolDefinitions, handleToolCall } from "../shared/tools.js";
import { runToolLoop } from "../shared/claude.js";
import { logEvent } from "../shared/logger.js";

const writerToolDefs = toolDefinitions.filter((t) => ["retrieve_context", "save_draft"].includes(t.name));

function buildSystemPrompt(feedback) {
  return `You draft a short, tailored outreach paragraph for one specific job lead, on behalf of an
Engineering Manager candidate.

Rules:
- Ground every factual claim in retrieved CV/cover-letter context via retrieve_context. Never
  invent experience, titles, dates, or achievements - if the context doesn't support a claim,
  leave it out rather than guessing.
- Match the candidate's established voice: UK English, no em dashes, no colons used as a
  stylistic flourish, direct and concrete over generic enthusiasm.
- Be specific to this lead - reference the actual company/role, not phrasing generic enough to
  apply to any job.
- Call retrieve_context at least once before drafting.
- When the draft is ready, call save_draft with the lead's link (unchanged from the input), the
  draft text, and status "pending_review".${
    feedback
      ? `\n\nThe previous draft was rejected on review with this feedback - address it directly:\n${feedback}`
      : ""
  }`;
}

export async function runWriter(lead, feedback = null) {
  const userPrompt = `Draft outreach for this lead:\n${JSON.stringify(lead, null, 2)}`;

  const savedDrafts = [];
  const wrappedHandler = async (name, input) => {
    const result = await handleToolCall(name, input);
    if (name === "save_draft" && result?.saved) savedDrafts.push(result.draft);
    return result;
  };

  await runToolLoop({
    agentName: "writer",
    systemPrompt: buildSystemPrompt(feedback),
    userPrompt,
    tools: writerToolDefs,
    handleToolCall: wrappedHandler,
    onLog: logEvent,
  });

  return savedDrafts[savedDrafts.length - 1] || null;
}
