// PRD Phase 4: the Critic agent - pure evaluation, no tools. Scores a draft
// against the rubric from PRD section 7 and returns structured JSON so the
// Orchestrator's retry loop can act on it programmatically rather than
// parsing prose.
//
// Deliberately a single call, not a tool-use loop: the Critic doesn't need
// to look anything up, it judges what it's given.

import { client } from "../shared/claude.js";
import { logEvent } from "../shared/logger.js";

const RUBRIC_SCHEMA = {
  type: "object",
  properties: {
    factual_grounding: {
      type: "boolean",
      description: "Does every claim in the draft trace to a real CV/cover-letter fact, with nothing invented?",
    },
    tone_match: {
      type: "boolean",
      description: "UK English, no em dashes, no colons used as a stylistic flourish, direct over generic enthusiasm?",
    },
    specificity: {
      type: "boolean",
      description: "Does it reference the actual job/company, rather than boilerplate that could apply to any role?",
    },
    pass: {
      type: "boolean",
      description: "True only if factual_grounding, tone_match, and specificity are all true.",
    },
    feedback: {
      type: "string",
      description: "Specific, actionable feedback the Writer can act on if pass is false. Empty string if pass is true.",
    },
  },
  required: ["factual_grounding", "tone_match", "specificity", "pass", "feedback"],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You are a strict but fair reviewer of AI-drafted job outreach paragraphs. You did not see
the retrieval results the Writer used, so judge factual grounding by whether claims read as
specific and plausible for a real CV rather than generically impressive or suspiciously vague.
An LLM critiquing another LLM's output is a second opinion, not ground truth - when genuinely
unsure whether a claim is invented, say so in feedback rather than guessing pass/fail.`;

export async function runCritic(lead, draftText) {
  const start = Date.now();
  const response = await client.messages.parse({
    model: "claude-sonnet-5",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Lead:\n${JSON.stringify(lead, null, 2)}\n\nDraft:\n${draftText}`,
      },
    ],
    output_config: { format: { type: "json_schema", schema: RUBRIC_SCHEMA } },
  });
  const latencyMs = Date.now() - start;

  logEvent({
    agent: "critic",
    model: "claude-sonnet-5",
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    latency_ms: latencyMs,
    tool_calls: [],
  });

  return response.parsed_output;
}
