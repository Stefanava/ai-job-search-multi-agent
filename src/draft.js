// Phase 3 of 3: run the Writer -> Critic loop, but only on leads a human
// already approved in src/review.js. See src/agents/orchestrator.js's
// header comment for why the Orchestrator no longer decides this itself.
//
// Usage:
//   node --env-file=.env src/draft.js

import { orchestrate } from "./agents/orchestrator.js";
import { getLeadsByStatus } from "./shared/tools.js";

async function main() {
  const approved = getLeadsByStatus("approved_for_draft");

  if (approved.length === 0) {
    console.log("Nothing approved for drafting. Run `npm run review` first.");
    return;
  }

  console.log(`Drafting outreach for ${approved.length} approved lead(s)...`);
  await orchestrate(approved);
}

main().catch((err) => {
  console.error("Draft failed:", err);
  process.exit(1);
});
