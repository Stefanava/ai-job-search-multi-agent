// The Writer -> Critic retry loop, run only on leads a human has already
// approved in the review step. Plain code, no model call of its own: it
// runs the Writer, has the Critic score the draft, and retries with the
// Critic's feedback up to MAX_RETRIES times.
//
// This file used to be src/agents/orchestrator.js, when an LLM Orchestrator
// coordinated the whole run: it called the Researcher, then made one
// unattended routing call (selectLeadsForDrafting) deciding which leads were
// worth spending Writer/Critic cost on. That routing call was the decision
// most worth not trusting further than it's earned, so it's been replaced by
// the Screener (src/agents/screener.js, advisory only) plus an explicit human
// review step (src/review.js). Lead discovery moved into src/scan.js
// alongside the Screener, since there's no real decision between "find
// leads" and "screen the leads you found". With no routing left for a model
// to make, coordination is now ordinary code across scan.js, review.js and
// draft.js, with each lead's status field carrying the state between them
// (see README.md's "How the steps are coordinated").

import { runWriter } from "./agents/writer.js";
import { runCritic } from "./agents/critic.js";
import { summarizeRunLog } from "./shared/logger.js";

const MAX_RETRIES = 2; // 1 initial attempt + up to 2 retries, per PRD's cost cap

// Exported (in addition to draftApprovedLeads) so src/evalQuery.js can run this
// same retry loop on a single lead for a per-query eval call, without
// duplicating it. options.handleToolCall lets evalQuery.js pass isolated,
// in-memory tool state - see runWriter's comment in writer.js. Real usage
// via draftApprovedLeads() below never passes options, so it's unaffected.
export async function writeAndCritique(lead, options = {}) {
  let feedback = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const draft = await runWriter(lead, feedback, options);
    if (!draft) {
      console.warn(`[draft-loop] Writer produced no draft for "${lead.name}" - skipping.`);
      return { draft: null, score: null };
    }

    const score = await runCritic(lead, draft.draft_text);

    if (score.pass) {
      console.log(`[draft-loop] Draft for "${lead.name}" passed review on attempt ${attempt + 1}.`);
      return { draft, score };
    }

    console.log(
      `[draft-loop] Draft for "${lead.name}" failed review (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${score.feedback}`
    );
    feedback = score.feedback;

    if (attempt === MAX_RETRIES) return { draft, score }; // out of retries - return the last attempt, unpassed
  }
}

// approvedLeads: leads with status approved_for_draft, decided by a human
// in src/review.js. This function trusts that approval and does not
// re-evaluate it - see the file header for why that split exists.
export async function draftApprovedLeads(approvedLeads) {
  const runStartedAt = new Date().toISOString();

  const results = [];
  for (const lead of approvedLeads) {
    console.log(`\n=== Writer -> Critic loop: "${lead.name}" ===`);
    const { draft, score } = await writeAndCritique(lead);
    results.push({ lead, draft, score });
  }

  const passedCount = results.filter((r) => r.score?.pass).length;
  const { calls, totalCostUsd } = summarizeRunLog(runStartedAt);

  console.log("\n=== Final digest ===");
  console.log(`Drafted outreach for ${passedCount}/${approvedLeads.length} approved lead(s) (all drafts saved to data/drafts.json for review regardless of pass/fail).`);
  for (const r of results) {
    console.log(`- ${r.lead.name}: ${r.score?.pass ? "PASSED review" : "did not pass review after retries"}`);
  }
  console.log(`\nThis run: ${calls} model call(s), ~$${totalCostUsd}`);

  return { results };
}
