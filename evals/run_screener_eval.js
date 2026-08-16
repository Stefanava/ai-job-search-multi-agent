// Eval suite for the Screener agent. Runs it against a fixed set of
// human-labelled test cases (evals/cases.json) and reports where its
// judgement agrees or disagrees with the reference answer.
//
// Deliberately does NOT exit non-zero on a disagreement, and does not
// silently "pass" or "fail" the Screener. A disagreement here is exactly
// the kind of thing a person should look at, not something to automate
// past. The point of this eval isn't to gate a build the way a unit test
// would; it's to catch prompt regressions (a Screener prompt edit that
// quietly makes it reject strong matches, for instance) before you find
// out about it by never seeing a lead again.
//
// Usage: npm run eval:screener

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { runScreener } from "../src/agents/screener.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { cases } = JSON.parse(fs.readFileSync(path.join(__dirname, "cases.json"), "utf-8"));

function scoreInBand(score, ref) {
  return typeof score === "number" && score >= ref.min_score && score <= ref.max_score;
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set. Copy .env.example to .env and fill it in, or export it directly.");
    process.exit(1);
  }

  console.log(`Running Screener eval against ${cases.length} fixed case(s)...\n`);

  const results = [];

  for (const testCase of cases) {
    const { verdict } = await runScreener(testCase.lead);

    const recommendationMatch = verdict.recommendation === testCase.reference.recommendation;
    const scoreMatch = scoreInBand(verdict.fit_score, testCase.reference);
    const gapMatch = testCase.reference.expected_gap_keyword
      ? (verdict.gaps || []).some((g) => g.toLowerCase().includes(testCase.reference.expected_gap_keyword.toLowerCase()))
      : null;

    const agree = recommendationMatch && scoreMatch;

    results.push({
      id: testCase.id,
      why: testCase.why,
      expected: testCase.reference,
      actual: { recommendation: verdict.recommendation, fit_score: verdict.fit_score, gaps: verdict.gaps },
      recommendation_match: recommendationMatch,
      score_in_band: scoreMatch,
      expected_gap_mentioned: gapMatch,
      agree,
    });

    const flag = agree ? "AGREE" : "DISAGREE";
    console.log(`[${flag}] ${testCase.id}`);
    console.log(`  expected: ${testCase.reference.recommendation}, ${testCase.reference.min_score}-${testCase.reference.max_score}`);
    console.log(`  actual:   ${verdict.recommendation}, ${verdict.fit_score}`);
    if (gapMatch === false) console.log(`  expected gap keyword "${testCase.reference.expected_gap_keyword}" not mentioned`);
    console.log("");
  }

  const agreeCount = results.filter((r) => r.agree).length;
  console.log(`----------------------------------------------------------------`);
  console.log(`${agreeCount}/${results.length} cases agreed with the reference answer.`);
  console.log(`This is a prompt-quality signal, not a build gate - read the disagreements above,`);
  console.log(`don't just look at the count.`);

  const resultsDir = path.join(__dirname, "results");
  fs.mkdirSync(resultsDir, { recursive: true });
  const outPath = path.join(resultsDir, `eval_${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nFull results written to ${path.relative(process.cwd(), outPath)}`);
}

main();
