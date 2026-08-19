// Per-query invocation contract for build-vs-buy-eval's comparison. Gives
// this project (Variant D) the same runQuery(query) -> { finalText, usage,
// leads, drafts } shape Variants B and C already have (see
// build-vs-buy-eval/variants/*/agent.js and lib/agentLoop.js's return
// shape), so all three can be scored against the identical 8 fixed queries
// in config/fixed_queries.json instead of Variant D only ever covering
// q1-q4 via a retrofitted whole-cycle import.
//
// build-vs-buy-eval/run_variant.js imports this module directly (a plain
// cross-project file import, no package boundary) and calls
// runQuery(query, options) once per fixed query, exactly as it already does
// for Variants B and C (which ignore the second argument).
//
// IMPORTANT - read before trusting a side-by-side score against B/C:
//
// 1. This is NOT how the project is meant to be used day to day. Real use
//    is src/scan.js -> src/review.js -> src/draft.js, with a human deciding
//    which leads are worth drafting for (src/review.js) before any Writer/
//    Critic cost is spent.
//
// 2. options.reviewMode controls how the one drafting decision this flow
//    makes (query.type "research_and_draft" only) gets made:
//      "auto"   (default) - auto-approves whatever the Screener itself
//               recommends "proceed" on. An automated comparison run can't
//               pause for a person, so this measures the chained agents'
//               own judgement, not the full human-reviewed system. That's
//               a real, named trade-off, not a bug - see build-vs-buy-eval's
//               README for how this factors into the decision write-up
//               (auto review is free but is a different, unproven system;
//               manual review is the real system but costs real time).
//      "manual" - asks a real person at the keyboard via
//               src/eval/manualReview.js, same as src/review.js does for
//               real use, just scoped to one lead inline instead of a
//               queue. Requires an actual terminal - will hang unattended.
//
// 3. Leads/drafts produced during an eval run live only in memory for that
//    one query (src/eval/evalTools.js) - they are never written to
//    data/leads.json or data/drafts.json, so running this can't mix
//    fixture/comparison output into Stefan's real job-search pipeline data.
//
// 4. Every job lead the Researcher finds still goes through the Screener,
//    matching the real pipeline's per-lead cost (see README's "Cost
//    multiplication" caveat) - Writer/Critic only run on top of that for
//    query.type "research_and_draft" and "draft_only", same as the real
//    pipeline only drafts for leads a human (or, in auto mode, the
//    Screener's own recommendation) approved past screening.
//
// 5. Every screened lead - proceed, hold, or reject - is returned under
//    `screening` below, not just the ones that got drafted. build-vs-buy-eval's
//    run_variant.js uses this to build a post-run summary (and, for auto
//    runs, an email) of what got rejected and what was close - "close"
//    meaning the Screener's own "hold" recommendation (its built-in
//    not-a-clear-yes-or-no signal), not an invented numeric threshold.
//
// 6. Model calls made here still log to data/run_log.jsonl (gitignored) -
//    that's how usage.cost_usd below is computed, matching the real
//    pipeline's own cost accounting. It mixes eval-run cost into the same
//    log real usage writes to; harmless (it's just a log), but worth
//    knowing if you ever eyeball that file expecting only real runs in it.
//
// 7. Meetup queries never reach this function. run_variant.js skips them
//    for every variant before calling runQuery at all - meetup search stays
//    real and available for actual weekly use of this project (npm run
//    scan, no flag), it's just not part of what build-vs-buy-eval runs or
//    scores. So the Researcher call below always runs jobsOnly: true.

import { runResearcher } from "./agents/researcher.js";
import { runScreener } from "./agents/screener.js";
import { writeAndCritique } from "./agents/orchestrator.js";
import { createEvalTools } from "./eval/evalTools.js";
import { askHumanToApprove } from "./eval/manualReview.js";
import { summarizeRunLog } from "./shared/logger.js";

export async function runQuery(query, { reviewMode = "auto" } = {}) {
  const runStartedAt = new Date().toISOString();
  const tools = createEvalTools();
  const textParts = [];
  const screening = { proceeded: [], held: [], rejected: [] };

  if (query.type === "draft_only") {
    // q5: every variant is handed the identical fixed lead and told not to
    // search - so this skips the Researcher/Screener entirely and drafts
    // directly, the same way Variant B/C's runQuery does for this query.
    // reviewMode doesn't apply here on purpose: q5 exists specifically to
    // isolate RAG-grounding quality on an identical input, and adding a
    // draft/don't-draft decision would break that control.
    // fixed_queries.json's fixed_lead uses company/role field names (matching
    // Variant B/C's own lead schema); this project's leads use name/
    // title_or_topic instead (see shared/tools.js). Normalized here so the
    // Writer sees the same lead shape it always does, and so orchestrator.js's
    // console logging (which reads lead.name) doesn't print "undefined".
    const normalizedLead = {
      type: "job",
      name: query.fixed_lead.company,
      title_or_topic: query.fixed_lead.role,
      location: query.fixed_lead.location,
      link: query.fixed_lead.link,
      note: query.fixed_lead.note,
    };
    const result = await writeAndCritique(normalizedLead, { handleToolCall: tools.handleToolCall });
    textParts.push(
      result?.draft
        ? `Drafted outreach for ${query.fixed_lead.company} (${result.score?.pass ? "passed" : "did not pass"} review).`
        : "No draft produced."
    );
  } else {
    // research, research_and_draft, and the narrow edge-case query (q8) all
    // start the same way: the query's own prompt IS the Researcher's task,
    // exactly like Variant B/C get the query's prompt as their whole
    // instruction. Always jobsOnly: build-vs-buy-eval's run_variant.js
    // deliberately never sends a meetup-type query here at all (see its
    // header comment) - meetup search stays a real, optional part of this
    // project's actual weekly-use workflow (npm run scan, no flag), it's
    // just not something this comparison runs or scores.
    const { newLeads, summary } = await runResearcher(query.prompt, {
      jobsOnly: true,
      handleToolCall: tools.handleToolCall,
    });
    textParts.push(summary);

    for (const lead of newLeads) {
      const { verdict } = await runScreener(lead);
      const entry = { lead, verdict };
      if (verdict.recommendation === "proceed") screening.proceeded.push(entry);
      else if (verdict.recommendation === "hold") screening.held.push(entry);
      else screening.rejected.push(entry);
      // Screener still runs (and its cost still counts) even when this query
      // type doesn't draft - that per-lead screening cost is real and part
      // of what's being compared, not something to skip for a cheaper number.

      if (query.type === "research_and_draft") {
        const approved =
          reviewMode === "manual" ? await askHumanToApprove(lead, verdict) : verdict.recommendation === "proceed";
        if (approved) await writeAndCritique(lead, { handleToolCall: tools.handleToolCall });
      }
    }
  }

  const { calls, totalCostUsd } = summarizeRunLog(runStartedAt);

  return {
    finalText: textParts.filter(Boolean).join("\n\n"),
    leads: tools.getLeads(),
    drafts: tools.getDrafts(),
    usage: { model_calls: calls, cost_usd: totalCostUsd },
    screening,
  };
}
