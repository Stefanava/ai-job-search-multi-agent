# AI Job Search Multi-Agent System

Multi-agent evolution of [`ai-job-search-agent`](https://github.com/Stefanava/ai-job-search-agent), built per
[`PRD.md`](./PRD.md). Same framework-free, hand-rolled-loop ethos as the single-agent project — no agent
framework, so every part of what "an agent" actually is stays visible.

## What it does

The pipeline runs in three explicit phases, not one unattended pass, with a human decision required between
phase 1 and phase 3:

1. **`npm run scan`** — the **Researcher** searches job boards/meetups via `web_search`, checks exclusions,
   and saves new leads. Every new job lead then goes through the **Screener**, which scores it against the
   real CV/cover-letter context and produces a fit score, matched signals, gaps, and a recommendation
   (`proceed` / `hold` / `reject`) — but doesn't act on it. Meetups skip screening (there's no CV-fit
   question for an event) and go straight to review.
2. **`npm run review`** — an interactive CLI shows each lead, the Screener's full reasoning, and asks you to
   approve, reject, or hold it yourself. Nothing moves past this step without a human decision.
3. **`npm run draft`** — only for leads you approved: the **Writer** retrieves relevant CV/cover-letter
   context (`retrieve_context`) and drafts a tailored outreach paragraph, grounded only in what it
   retrieved. The **Critic** scores the draft against a rubric (factual grounding, tone match, specificity).
   On fail, the Writer retries with the Critic's feedback, up to twice.

Every draft — passed or not — is saved to `data/drafts.json` for a final human read. **Nothing is ever sent
anywhere automatically**, and no lead is ever screened out of the pipeline without a human seeing why.

## Why three phases instead of one

The original design had an Orchestrator make one autonomous routing call — "of this run's new leads, which
are worth drafting outreach for?" — with no check on that decision before Writer/Critic spent real API cost
acting on it. That's a system quietly filtering its own job search: leads it decided weren't worth drafting
for would simply never surface again, with no record of what was excluded or why.

The Screener replaces that call, but its recommendation is advisory only (see
`config/screener_rubric.json`) — it scores, it doesn't decide. Every lead it scores lands in
`pending_review`, and a person looks at the actual reasoning in `src/review.js` before anything else happens
to it. `evals/` exists so a Screener prompt change can be checked against a fixed set of human-labelled
cases, to catch its judgement quietly drifting before that would otherwise go unnoticed.

## Architecture

```
src/
  shared/
    claude.js       Anthropic client + the generic tool-use loop (Researcher and Writer both use this
                     instead of each carrying their own copy)
    tools.js         Client tools: list_excluded_companies, list_existing_leads, save_lead, retrieve_context,
                     save_draft, plus getAllLeads/getLeadsByStatus/updateLeadStatus for the review step
    retrieval.js     retrieve_context's implementation - chunking, embedding, in-memory cosine search
    logger.js        Per-call logging (tokens, cost, latency) to data/run_log.jsonl
  agents/
    researcher.js    Finds and saves leads (unchanged from the single-agent project)
    screener.js      Scores each new job lead's fit against the real CV, advisory only
    writer.js        Drafts outreach for approved leads
    critic.js         Scores drafts against a rubric, structured JSON output, no tools
    orchestrator.js   The Writer/Critic retry loop only - runs solely on leads a human already approved
  scan.js             Phase 1: Researcher -> Screener
  review.js           Phase 2: human approve/reject/hold, interactive CLI
  draft.js            Phase 3: Writer/Critic loop on approved leads only
  run.js              Retired - points to the three scripts above
evals/
  cases.json           Fixed, human-labelled Screener test cases
  run_screener_eval.js  Runs the Screener against them, reports agreement, never gates a build
```

See `PRD.md` §6 for why this is a supervisor pattern rather than a fixed pipeline or an event-driven swarm —
the short version: the Writer step genuinely depends on the Researcher's output, and the Critic's retry
loop needs a coordinator, so it's the pattern actually earning its complexity here, not orchestration for
its own sake.

## Retrieval

`retrieve_context` uses [Voyage AI](https://voyageai.com) (Anthropic's recommended embeddings provider —
Claude itself has no embeddings endpoint) for real semantic search, with an in-memory array of chunks, not
a vector DB — the corpus is a handful of documents; a vector DB would be infrastructure the problem doesn't
need. If `VOYAGE_API_KEY` isn't set, it falls back to word-overlap matching instead of failing outright, so
the whole pipeline still runs with only `ANTHROPIC_API_KEY` configured — just with visibly worse retrieval
(a console warning says so every time). Set `VOYAGE_API_KEY` for the real thing.

## Setup

```bash
cd ai-job-search-multi-agent
npm install
cp .env.example .env
# edit .env: add your real ANTHROPIC_API_KEY (required), VOYAGE_API_KEY (optional but recommended)
cp data/excluded_companies.example.json data/excluded_companies.json  # or your own real data
npm run scan
npm run review
npm run draft
```

Or with a custom scan instruction:

```bash
node --env-file=.env src/scan.js "Just check for new meetups in Barcelona this week, skip the job search"
```

Run the Screener eval any time (doesn't need real leads or a real API key beyond `ANTHROPIC_API_KEY`):

```bash
npm run eval:screener
```

### Grounding drafts in your real CV

Drop your real CV and past cover letters into `context/` as `.md`, `.txt`, or `.docx` files (that directory
is gitignored — nothing there gets pushed). Until you do, the Screener and Writer use the fake example CV in
`context/example/`, so the pipeline is demoable without your real documents from the first run.

### Compensation floor

`config/criteria.json`'s `compensation_floor` ships blank (`null`/`null`) in this repo on purpose — it's a
real negotiating position, not something to publish in a public git history. Set your own numbers in a
local, uncommitted edit if you want the Researcher to weigh compensation.

## Data files (gitignored — real pipeline data, never committed)

- **`data/excluded_companies.json`** / **`data/leads.json`** — leads carry a `status` field
  (`pending_screen` → `pending_review` → `approved_for_draft` / `rejected_by_human` / `held_by_human`),
  keyed by each lead's `link`.
- **`data/drafts.json`** — every draft the Writer produces, pass or fail, with its `status`. Starts empty.
- **`data/run_log.jsonl`** — one JSON line per model call across every agent: tokens, cost, latency, which
  tools were called. This is what `orchestrate()`'s final digest sums for the per-run cost line.

Fake stand-ins with the same shape ship in the repo so it's runnable out of the box:
`data/excluded_companies.example.json`, `context/example/cv.md`.

## What this demonstrates (per PRD §11)

Multi-agent orchestration with a documented rationale for the pattern chosen, tool design across multiple
cooperating agents, retrieval-augmented generation at a scale that doesn't reach for infrastructure it
doesn't need, a self-critique/retry loop, per-agent cost/latency observability, and an explicit human-in-
the-loop gate on the one step (deciding a lead's fate) that shouldn't be fully automated even when it could
be — plus a small eval suite so that gate's own judgement can be checked, not just trusted.

## Open questions (per PRD §10)

- **Cost multiplication.** Four chained agent calls per lead (Researcher, Screener, Writer, Critic) cost
  more than the single-agent version. `data/run_log.jsonl` + the final digest's cost line exist specifically
  so this is measured, not assumed.
- **RAG quality on a small corpus.** With only a handful of source documents, embedding search may not
  meaningfully outperform just pasting the whole CV into context. Worth testing both, honestly.
- **The Critic is a second opinion, not ground truth.** An LLM critiquing another LLM's output doesn't
  verify correctness — its own system prompt says as much. Don't oversell a high pass rate as proof of
  quality; a *very* high first-pass rate is more likely a lenient critic than a great writer.
- **The Screener is advisory, not ground truth either.** Same caveat as the Critic — its `evals/` agreement
  rate is a prompt-quality signal, not proof it's finding the right leads. The human review step exists
  precisely because this shouldn't be trusted further than it's earned.

## Not built (PRD's non-goals, and the Phase 6 stretch goal)

No vector DB (by design — see Retrieval above), no LinkedIn automation (same reasoning as the single-agent
project: automating a logged-in session is the exact pattern LinkedIn's bot detection is built to catch),
no auth/multi-user/uptime guarantees. Phase 6 (human-in-the-loop) is now built — see "Why three phases
instead of one" above. A reasonable next extension: a `save_draft` status beyond `pending_review` (e.g.
marking one as sent once you've actually used it by hand).
