# 🛠️ @gopluto_ai/llm-tools-orchestration

> Scalable LLM tool orchestration SDK with memory hooks, parallel Multi function execution, and GPT-4o (or any model) planning — built for production AI agents. Alternative of MCP for AI or LLM Parallel multi tool calling which is easy to understand.

---

## 🚀 Features

- ✅ Register tools with full JSON schema
- 🧠 Pre/post tool memory lifecycle hooks
- 🔍 Plans tools dynamically using OpenAI `/v1/responses` API (⚠️ not chat completion)
- 🛠️ Parallel tool execution with context-rich synthesis
- 🔄 ESM + CommonJS ready for Node.js and serverless
- 🔌 Works with any GPT model (`gpt-4o`, `gpt-4-turbo`, etc.) — dynamic model control

---

## 📦 Installation

```bash
npm install @gopluto_ai/llm-tools-orchestration
```

---

## ⚡ Quick Example

```ts
import {
  registerTool,
  planTools,
  executeParallelTools,
  synthesizeFinalReply,
  registerHookProcessor
} from "@gopluto_ai/llm-tools-orchestration";
import { getOpenAIResData } from "@gopluto_ai/llm-tools-orchestration/dist/openaiHelpers";

registerHookProcessor("logStart", async (memory) => {
  console.log("🧠 Memory:", memory);
  return memory;
});

registerTool({
  type: "function",
  name: "get_stock_price",
  description: "Returns dummy stock price",
  parameters: {
    type: "object",
    required: ["ticker", "currency"],
    properties: {
      ticker: { type: "string" },
      currency: { type: "string" }
    }
  },
  preHooks: ["logStart"],
  handler: async ({ ticker, currency }) => {
    return { ticker, currency, price: 999.99 };
  }
});

const messages = {
  sysprompt: "You are a stock price assistant.",
  userMessage: "What's the price of TSLA in USD?",
  conversationHistory: [],
  agentMemory: {},
  imageUrl:'',
  fileUrl:''
};

(async () => {
  const plan = await planTools(messages, getOpenAIResData, "gpt-4o");
  const results = await executeParallelTools(plan.neededTools, plan.args, { userId: "xyz" });
  const reply = await synthesizeFinalReply(messages.userMessage, results, messages, getOpenAIResData, "gpt-4o");

  console.log("🧠 Final AI Reply:", reply);
})();
```

---

## 📁 Structure

```
src/
├── index.ts                  # Entry point
├── toolOrchestrator.ts       # Tool registration + planning
├── openaiHelpers.ts          # Handles OpenAI /v1/responses payloads
examples/
└── index.js                  # CLI-ready use case
```

---

## 🔒 This SDK Uses OpenAI's `/v1/responses` Endpoint

Unlike typical `chat/completions`, this SDK uses the **new `/v1/responses`** API to support multi-modal inputs (text, file, image) and tool usage natively.

This gives you:
- Context-rich messages (system + memory)
- Native tool calling structure
- Easy agent memory injection
- Full control over function outputs

---

## 🤝 Contributing

1. Clone this repo
2. Run `npm install && npm run build`
3. Edit tools in `src/toolOrchestrator.ts`
4. Submit PRs!

---

## 📝 License

MIT © [GoPluto.ai](https://gopluto.ai)
