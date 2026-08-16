// The Screener - scores how well ONE job lead fits the candidate's real CV,
// grounded in retrieve_context, before any Writer effort is spent on it.
// Like the Critic, this is a single structured-output call, no tool loop -
// it doesn't need to look anything up beyond the one retrieval call, and
// keeping it this simple means there's no ambiguity about what it did.
//
// Its recommendation is advisory only (see config/screener_rubric.json). It
// never changes a lead's status itself - that only happens in the human
// review step (src/review.js). This replaces the Orchestrator's old
// selectLeadsForDrafting call, which made that decision autonomously in one
// LLM call with no human check before Writer/Critic spent real API cost on
// whatever it selected.

import { client } from "../shared/claude.js";
import { retrieveContext } from "../shared/retrieval.js";
import { logEvent } from "../shared/logger.js";

const SCREENER_SCHEMA = {
  type: "object",
  properties: {
    fit_score: { type: "integer", description: "1 (poor fit) to 5 (strong fit)" },
    matched_signals: {
      type: "array",
      items: { type: "string" },
      description: "Specific things from the retrieved context that genuinely support this being a good match",
    },
    gaps: {
      type: "array",
      items: { type: "string" },
      description: "Specific things the role asks for that the retrieved context doesn't support, or flags for a human to weigh",
    },
    recommendation: { type: "string", enum: ["proceed", "hold", "reject"] },
    rationale: { type: "string", description: "1-3 sentences, grounded only in what was actually retrieved" },
  },
  required: ["fit_score", "matched_signals", "gaps", "recommendation", "rationale"],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You score how well ONE job lead fits the candidate's real background, using only the
retrieved CV/cover-letter context you're given, not general impressions of the company or role.

You are advisory only. You do not decide what happens to this lead - a human reviews every lead you
score before anything else happens to it. Your job is to make that review fast and honest, not to
filter anything yourself. If the retrieved context doesn't support a claim, say so in gaps rather
than guessing.`;

export async function runScreener(lead) {
  const query = [lead.title_or_topic, lead.name, lead.note].filter(Boolean).join(" ");
  const retrieved = await retrieveContext(query, 5);

  const start = Date.now();
  const response = await client.messages.parse({
    model: "claude-sonnet-5",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content:
          `Lead to score:\n${JSON.stringify(lead, null, 2)}\n\n` +
          `Retrieved CV/cover-letter context (the ONLY source of truth about the candidate's background, ` +
          `do not use anything else):\n${JSON.stringify(retrieved, null, 2)}`,
      },
    ],
    output_config: { format: { type: "json_schema", schema: SCREENER_SCHEMA } },
  });
  const latencyMs = Date.now() - start;

  logEvent({
    agent: "screener",
    model: "claude-sonnet-5",
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    latency_ms: latencyMs,
    tool_calls: [],
  });

  return { verdict: response.parsed_output, retrieved };
}
