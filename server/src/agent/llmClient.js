import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

// Runs a bounded tool-calling loop against Groq's OpenAI-compatible chat API.
// `tools` is the allowlist for THIS call site — callers control what's bound,
// which is what makes per-node tool restriction (Phase 3) possible later.
export async function runAgentLoop({ messages, tools, executeTool, maxSteps = 5, toolChoice }) {
  const toolCalls = [];
  let currentMessages = [...messages];

  for (let step = 0; step < maxSteps; step++) {
    const response = await groq.chat.completions.create({
      model: MODEL,
      messages: currentMessages,
      tools: tools && tools.length > 0 ? tools : undefined,
      tool_choice: tools && tools.length > 0 ? (toolChoice ?? "auto") : undefined,
      temperature: 0.2,
    });

    const msg = response.choices[0].message;
    currentMessages.push(msg);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return { finalMessage: msg.content, toolCalls, messages: currentMessages };
    }

    for (const toolCall of msg.tool_calls) {
      let args = {};
      try {
        args = JSON.parse(toolCall.function.arguments || "{}");
      } catch {
        args = { _parseError: toolCall.function.arguments };
      }
      const result = await executeTool(toolCall.function.name, args);
      toolCalls.push({ name: toolCall.function.name, args, result });
      currentMessages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }
  }

  return { finalMessage: "(max steps reached without a final answer)", toolCalls, messages: currentMessages };
}

export { MODEL };
