// Tool orchestration SDK
export type ToolFunction = (args: any, memory: any) => Promise<any>;

export interface ToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: any;
  handler: ToolFunction;
  preHooks?: string[];
  postHooks?: string[];
}

const toolRegistry: ToolDefinition[] = [];
const hookProcessors: Record<string, (memory: any) => Promise<any>> = {};

export const registerTool = (tool: ToolDefinition) => toolRegistry.push(tool);
export const registerHookProcessor = (hookName: string, processor: (memory: any) => Promise<any>) => {
  hookProcessors[hookName] = processor;
};
export const getToolSchemas = () =>
  toolRegistry.map(({ type, name, description, parameters }) => ({
    type, name, description, parameters,
  }));
export const getTool = (name: string) => toolRegistry.find(t => t.name === name);

const runHooks = async (hookNames: string[] = [], memory: any): Promise<any> => {
  for (const hook of hookNames) {
    const processor = hookProcessors[hook];
    if (processor) memory = await processor(memory);
  }
  return memory;
};

export const planTools = async (
  messages: {
    sysprompt: string;
    conversationHistory: any[];
    agentMemory?: Record<string, any>;
    userMessage: string;
  },
  getOpenAIResData: Function
): Promise<{
  tools?: any[];
  neededTools: string[];
  args: Record<string, any>;
  directReply?: string;
  convTopic?: string;
  newMemory?: Record<string, any>;
  modal?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    input_tokens_details?: { cached_tokens: number };
  };
}> => {
  const messagesData = {
    agentContext: messages.sysprompt,
    conversationHistory: messages.conversationHistory,
    agentMemory: messages.agentMemory || {},
    userPrompt: messages.userMessage,
    functions: getToolSchemas(),
  };

  console.log("🧠 Planning initiated with:", messagesData);

  const final = await getOpenAIResData(messagesData, "gpt-4o");

  console.log("📩 Response from OpenAI:", final);

  const message = final.aiResponse;

  // No tools triggered — direct reply
  if (message && (!final.function_call || final.function_call.length === 0)) {
    return {
      tools: [],
      neededTools: [],
      args: {},
      directReply: message,
      convTopic: final.convTopic || "General",
      newMemory: final.newMemory || {},
      modal: final.modal || "gpt-4o",
      usage: final.usage,
    };
  }

  // Tool calls exist — parse them
  if (Array.isArray(final.function_call) && final.function_call.length > 0) {
    const args: Record<string, any> = {};
    const neededTools: string[] = [];

    final.function_call.forEach((tool: any) => {
      const parsedArgs = typeof tool.arguments === "string"
        ? JSON.parse(tool.arguments)
        : tool.arguments;

      args[tool.name] = {
        ...parsedArgs,
        call_id: tool.call_id,
      };

      neededTools.push(tool.name);
    });

    return {
      tools: final.function_call,
      neededTools,
      args,
      directReply: message || "",
      convTopic: final.convTopic || "General",
      newMemory: final.newMemory || {},
      modal: final.modal || "gpt-4o",
      usage: final.usage,
    };
  }

  throw new Error("❌ Invalid GPT planning response format");
};

export const executeParallelTools = async (toolList: string[],   argsMap: Record<string, { [key: string]: any; call_id?: string }>, memory: any)=> {
  if (!Array.isArray(toolList) || toolList.length === 0) {
    throw new Error("No tools to execute");
  }
  const toolCalls = toolList.map(async (toolName) => {
    const tool = getTool(toolName);
    if (!tool) throw new Error(`Tool ${toolName} not found`);

    memory = await runHooks(tool.preHooks || [], memory);
    const result = await tool.handler(argsMap[toolName], memory);
    memory = await runHooks(tool.postHooks || [], memory);

    return {
      name: toolName,
      result,
      call_id: argsMap[toolName]?.call_id || null,
    };
  }); 
  const results = await Promise.all(toolCalls);
  return results;
}

export const synthesizeFinalReply = async ( userMessage: string,
  toolResults: any[],  
  messages: any,
  tools: [],
  getOpenAIResData: Function          
) =>{
  const toolResultsWithNames = toolResults.map(({ name, result, call_id }) => ({
    recipient_name: name,
    call_id,
    data: result, // Ensure data is always an object
  }));
 
  const agentContext = `
system context: ${messages.sysprompt.content}
Additional Instruction:
Here is the data returned by tools you called:
Please generate a useful, human-like reply summarizing and give the data what’s most relevant data in json.`;

  const messagesData = {
    agentContext, // ✅ now a string
    function_output: toolResultsWithNames,
    function_called: tools, // ✅ array of function calls
    conversationHistory: messages.conversationHistory,
    agentMemory: messages.agentMemory || {},
    userPrompt: messages.userMessage,
  };

  console.log("Synthesizing final reply with messages:");
  const final = await getOpenAIResData(messagesData, "gpt-4o");
  console.log("Final synthesized reply:");
  return final || { aiResponse: "No reply generated." };
}