// Interactive approve/reject prompt for evalQuery.js's manual review mode
// (see evalQuery.js's reviewMode option). Deliberately minimal compared to
// src/review.js's real interactive CLI - this only ever handles one lead at
// a time, inline in the per-query eval flow, not a queue of leads across a
// whole run. Requires a real terminal (stdin) - running this unattended
// (e.g. in CI) will hang waiting for input, which is the point: manual mode
// is for when Stefan is actually at the keyboard.

import { createInterface } from "node:readline/promises";

export async function askHumanToApprove(lead, verdict) {
  console.log(`\n[manual review] ${lead.name} - ${lead.title_or_topic || "n/a"}`);
  console.log(`  Screener: fit ${verdict.fit_score}/5, recommends "${verdict.recommendation}"`);
  console.log(`  Rationale: ${verdict.rationale}`);
  if (verdict.gaps?.length) console.log(`  Gaps: ${verdict.gaps.join("; ")}`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question("  Approve for drafting? (y/n) ")).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}
