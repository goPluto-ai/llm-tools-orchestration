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

export const planTools = async (messages: any, getOpenAIResData: Function) => {
  const messagesData = {
    agentContext: messages.sysprompt,
    conversationHistory: messages.conversationHistory,
    agentMemory: messages.agentMemory || {},
    userPrompt: messages.userMessage,
    functions: getToolSchemas(),
  };
  const final = await getOpenAIResData(messagesData, "gpt-4o");
  const message = final.aiResponse;

  if (message && !final.function_call) {
    return {
      neededTools: [],
      args: {},
      directReply: message,
      convTopic: final.convTopic || "General",
      newMemory: final.newMemory || {},
      modal: final.modal || "gpt-4o",
    };
  }

  const args: Record<string, any> = {};
  const neededTools: string[] = [];
  final.function_call.forEach((tool: any) => {
    args[tool.recipient_name] = tool.parameters;
    neededTools.push(tool.recipient_name);
  });

  return {
    tools: final.function_call,
    neededTools,
    args,
    modal: final.modal || "gpt-4o",
  };
};

export const executeParallelTools = async (toolList: string[], argsMap: Record<string, any>, memory: any) => {
  const toolCalls = toolList.map(async (toolName) => {
    const tool = getTool(toolName);
    if (!tool) throw new Error(`Tool ${toolName} not found`);

    memory = await runHooks(tool.preHooks, memory);
    const result = await tool.handler(argsMap[toolName], memory);
    memory = await runHooks(tool.postHooks, memory);

    return { name: toolName, result };
  });
  return await Promise.all(toolCalls);
};

export const synthesizeFinalReply = async (userMessage: string, toolResults: any[], messages: any, getOpenAIResData: Function) => {
  const toolResultsWithNames = toolResults.map(({ name, result }) => ({
    recipient_name: name,
    data: result,
  }));
  const messagesData = {
    agentContext: messages.sysprompt,
    functionCall: toolResultsWithNames,
    conversationHistory: messages.conversationHistory,
    agentMemory: messages.agentMemory || {},
    userPrompt: messages.userMessage,
  };
  const final = await getOpenAIResData(messagesData, "gpt-4o");
  return final.aiResponse || "No reply generated";
};
