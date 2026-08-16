// Shared Anthropic client + a generic Claude tool-use loop, factored out of
// ai-job-search-agent's original hand-rolled agent.js (PRD Phase 0) so
// Researcher and Writer don't each carry their own copy of the same ~50
// lines. Agents that make a single structured call instead of a loop
// (Orchestrator's routing decision, Critic) call `client` directly and
// don't need this.

import Anthropic from "@anthropic-ai/sdk";

export const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

const MAX_ITERATIONS = 20; // safety cap so a bug can't loop forever and burn tokens

export async function runToolLoop({
  agentName,
  systemPrompt,
  userPrompt,
  tools,
  handleToolCall,
  model = "claude-sonnet-5",
  maxIterations = MAX_ITERATIONS,
  onLog,
}) {
  const messages = [{ role: "user", content: userPrompt }];

  for (let i = 0; i < maxIterations; i++) {
    const start = Date.now();
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      tools,
      messages,
    });
    const latencyMs = Date.now() - start;

    if (onLog) {
      onLog({
        agent: agentName,
        model,
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        latency_ms: latencyMs,
        tool_calls: response.content.filter((b) => b.type === "tool_use").map((b) => b.name),
      });
    }

    messages.push({ role: "assistant", content: response.content });

    // Log what happened this turn so the loop is visible, not a black box.
    for (const block of response.content) {
      if (block.type === "text" && block.text.trim()) {
        console.log(`\n[${agentName}]`, block.text.trim());
      } else if (block.type === "server_tool_use") {
        console.log(`\n[${agentName}:web_search] "${block.input.query}"`);
      } else if (block.type === "tool_use") {
        console.log(`\n[${agentName}:tool] ${block.name}(${JSON.stringify(block.input)})`);
      }
    }

    if (response.stop_reason !== "tool_use") {
      // "end_turn" (done) or "pause_turn" (long search - just resubmit as-is,
      // which happens naturally on the next loop iteration since `messages`
      // already has the paused turn appended).
      if (response.stop_reason === "pause_turn") continue;
      return { messages, finalResponse: response };
    }

    // Only CLIENT tool_use blocks need a local handler - server_tool_use
    // (web_search) is already resolved inside response.content.
    const clientCalls = response.content.filter((b) => b.type === "tool_use");
    if (clientCalls.length === 0) continue; // nothing for us to do this turn

    // Awaited even though most handlers are sync - retrieve_context calls an
    // embeddings API and is genuinely async, and awaiting a non-Promise
    // value just resolves immediately, so this is safe for every tool.
    const toolResults = await Promise.all(
      clientCalls.map(async (block) => {
        let result;
        try {
          result = await handleToolCall(block.name, block.input);
        } catch (err) {
          result = { error: String(err) };
        }
        return {
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
        };
      })
    );

    messages.push({ role: "user", content: toolResults });
  }

  console.warn(`\n[${agentName}] Hit the ${maxIterations}-iteration safety cap without finishing.`);
  return { messages, finalResponse: null };
}
