import { registerTool, planTools, executeParallelTools, synthesizeFinalReply, registerHookProcessor } from '../dist/index.cjs.js';
import { getOpenAIResData } from '../dist/openaiHelpers.js';

const memory = { userId: "user-123" };

registerHookProcessor("initMemory", async (mem) => {
  mem.init = true;
  return mem;
});

registerTool({
  type: "function",
  name: "get_stock_price",
  description: "Retrieves the current stock price for a given stock ticker",
  parameters: {
    type: "object",
    required: ["ticker", "currency"],
    properties: {
      ticker: { type: "string", description: "The stock ticker symbol" },
      currency: { type: "string", description: "Currency for price (USD, EUR)" }
    },
    additionalProperties: false
  },
  preHooks: ["initMemory"],
  handler: async ({ ticker, currency }, mem) => {
    return { price: "123.45", ticker, currency };
  }
});

(async () => {
  const messages = {
    sysprompt: "You are a financial assistant.",
    userMessage: "What's the price of AAPL in USD?",
    conversationHistory: [],
    agentMemory: {},
  };

  const plan = await planTools({ ...messages }, getOpenAIResData);
  const results = await executeParallelTools(plan.neededTools, plan.args, memory);
  const finalReply = await synthesizeFinalReply(messages.userMessage, results, messages, getOpenAIResData);

  console.log("Final AI Response:", finalReply);
})();
