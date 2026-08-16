// Phase 2 of 3: the human review gate. This is the whole point of the
// scan/review/draft split - nothing here is automatic. Every lead the
// Screener scored (or every meetup, which skips scoring) sits in
// pending_review until you look at it and decide yourself.
//
// Usage:
//   node --env-file=.env src/review.js

import readline from "readline";
import { getLeadsByStatus, updateLeadStatus } from "./shared/tools.js";

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
  const pending = getLeadsByStatus("pending_review");

  if (pending.length === 0) {
    console.log("Nothing pending review. Run `npm run scan` first.");
    return;
  }

  console.log(`${pending.length} lead(s) pending review.\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  for (const lead of pending) {
    console.log("─".repeat(60));
    console.log(`${lead.type === "meetup" ? "[meetup]" : "[job]"} ${lead.name}`);
    if (lead.title_or_topic) console.log(`  ${lead.title_or_topic}`);
    if (lead.location) console.log(`  Location: ${lead.location}`);
    console.log(`  Link: ${lead.link}`);
    if (lead.note) console.log(`  Note: ${lead.note}`);

    const v = lead.screener_verdict;
    if (v) {
      console.log(`\n  Screener: fit ${v.fit_score}/5, recommends ${v.recommendation}`);
      console.log(`  Rationale: ${v.rationale}`);
      if (v.matched_signals?.length) console.log(`  Matched: ${v.matched_signals.join("; ")}`);
      if (v.gaps?.length) console.log(`  Gaps/flags: ${v.gaps.join("; ")}`);
    } else {
      console.log("\n  (no Screener verdict - meetup lead)");
    }

    let answer;
    do {
      answer = (await ask(rl, "\n  [a]pprove / [r]eject / [h]old / [s]kip for now? ")).trim().toLowerCase();
    } while (!["a", "r", "h", "s"].includes(answer));

    if (answer === "a") {
      updateLeadStatus(lead.link, "approved_for_draft");
      console.log("  -> approved for drafting.");
    } else if (answer === "r") {
      updateLeadStatus(lead.link, "rejected_by_human");
      console.log("  -> rejected.");
    } else if (answer === "h") {
      updateLeadStatus(lead.link, "held_by_human");
      console.log("  -> held for later.");
    } else {
      console.log("  -> left pending, skipped for now.");
    }
    console.log();
  }

  rl.close();
  console.log("Run `npm run draft` to write outreach for anything approved.");
}

main().catch((err) => {
  console.error("Review failed:", err);
  process.exit(1);
});
