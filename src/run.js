// Retired. This used to be the single entry point, running Researcher then
// an autonomous Orchestrator selection then Writer/Critic in one unattended
// pass. It's been replaced by three explicit phases with a human review gate
// in between - see README.md for why:
//
//   npm run scan    - find leads, screen job leads for fit
//   npm run review  - look at the Screener's reasoning, approve/reject/hold
//   npm run draft   - write outreach only for what you approved
//
// This file is kept only so `node src/run.js` fails loudly instead of
// silently doing the old unattended thing.

console.error(
  "src/run.js is retired. Use `npm run scan`, then `npm run review`, then `npm run draft` instead - see README.md."
);
process.exit(1);
