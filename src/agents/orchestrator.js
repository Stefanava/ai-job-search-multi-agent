// The Orchestrator now only runs the Writer -> Critic retry loop, and only
// on leads a human has already approved in the review step. It no longer
// makes an autonomous routing decision (the old selectLeadsForDrafting) -
// that call used to decide, in one unattended LLM call, which leads were
// worth spending Writer/Critic cost on. It's been replaced by the Screener
// (src/agents/screener.js) plus an explicit human review step (src/review.js)
// between finding leads and drafting outreach for them. See README.md for
// why: an LLM deciding on its own which leads matter, with nothing checking
// that decision before real work happened on the back of it, is exactly the
// kind of thing worth not trusting further than it's earned.
//
// Lead discovery (the old runResearcher call here) has also moved out, into
// src/scan.js alongside the Screener - there's no real decision between
// "find leads" and "screen the leads you found," so that phase is plain
// code now, not another agent loop.

import { runWriter } from "./writer.js";
import { runCritic } from "./critic.js";
import { summarizeRunLog } from "../shared/logger.js";

const MAX_RETRIES = 2; // 1 initial attempt + up to 2 retries, per PRD's cost cap

// Exported (in addition to orchestrate) so src/evalQuery.js can run this
// same retry loop on a single lead for a per-query eval call, without
// duplicating it. options.handleToolCall lets evalQuery.js pass isolated,
// in-memory tool state - see runWriter's comment in writer.js. Real usage
// via orchestrate() below never passes options, so it's unaffected.
export async function writeAndCritique(lead, options = {}) {
  let feedback = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const draft = await runWriter(lead, feedback, options);
    if (!draft) {
      console.warn(`[orchestrator] Writer produced no draft for "${lead.name}" - skipping.`);
      return { draft: null, score: null };
    }

    const score = await runCritic(lead, draft.draft_text);

    if (score.pass) {
      console.log(`[orchestrator] Draft for "${lead.name}" passed review on attempt ${attempt + 1}.`);
      return { draft, score };
    }

    console.log(
      `[orchestrator] Draft for "${lead.name}" failed review (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${score.feedback}`
    );
    feedback = score.feedback;

    if (attempt === MAX_RETRIES) return { draft, score }; // out of retries - return the last attempt, unpassed
  }
}

// approvedLeads: leads with status approved_for_draft, decided by a human
// in src/review.js. This function trusts that approval and does not
// re-evaluate it - see the file header for why that split exists.
export async function orchestrate(approvedLeads) {
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
