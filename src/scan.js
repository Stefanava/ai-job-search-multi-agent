// Phase 1 of 3: find leads, then screen the job leads for fit.
//
// This replaces the old single `npm start` run. Researcher still finds and
// saves leads itself (via save_lead, through the tool loop) - that part is
// unchanged. What's new is that every job lead it saves lands as
// pending_screen, not ready to draft against yet, and this script's second
// half runs the Screener against each one so a human has something useful
// to review in src/review.js. Meetups skip screening (no CV-fit question
// for an event) and go straight to pending_review.
//
// Usage:
//   node --env-file=.env src/scan.js
//   node --env-file=.env src/scan.js --jobs-only
//   node --env-file=.env src/scan.js "custom research instruction"
//   node --env-file=.env src/scan.js "custom research instruction" --jobs-only
//
// --jobs-only excludes meetup search entirely (not just soft-discouraged -
// see agents/researcher.js's buildSystemPrompt). Built for running this
// project as Variant D in the build-vs-buy comparison, where the other
// variants are only ever scored on job queries.

import { runResearcher } from "./agents/researcher.js";
import { runScreener } from "./agents/screener.js";
import { getLeadsByStatus, updateLeadStatus } from "./shared/tools.js";

const args = process.argv.slice(2);
const jobsOnly = args.includes("--jobs-only");
const customPrompt = args.find((a) => a !== "--jobs-only");

const defaultPrompt = jobsOnly
  ? "Run this week's job search scan: find new Engineering Manager leads matching the configured criteria."
  : "Run this week's job search scan: find new Engineering Manager leads and relevant meetups, per the configured criteria.";

const prompt = customPrompt || defaultPrompt;

async function main() {
  console.log(`=== Researcher${jobsOnly ? " (jobs only)" : ""} ===`);
  const { newLeads, summary } = await runResearcher(prompt, { jobsOnly });
  console.log(summary || `Saved ${newLeads.length} new lead(s).`);

  const toScreen = getLeadsByStatus("pending_screen");
  if (toScreen.length === 0) {
    console.log("\nNo leads pending screening.");
    return;
  }

  console.log(`\n=== Screener (${toScreen.length} lead(s) pending) ===`);
  for (const lead of toScreen) {
    const { verdict } = await runScreener(lead);
    updateLeadStatus(lead.link, "pending_review", { screener_verdict: verdict });
    console.log(
      `- ${lead.name} (${lead.title_or_topic || "n/a"}): fit ${verdict.fit_score}/5, recommends ${verdict.recommendation}`
    );
  }

  console.log("\nRun `npm run review` to see the Screener's reasoning and approve, reject, or hold each lead.");
}

main().catch((err) => {
  console.error("Scan failed:", err);
  process.exit(1);
});
