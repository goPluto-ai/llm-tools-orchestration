import axios from "axios";
import path from "path";

export interface OpenAIInput {
  agentContext: string;
  conversationHistory: string[];
  agentMemory: Record<string, any> | null;
  userPrompt: string;
  imageUrl?: string;   // put a public URL here or omit
  fileUrl?: string;   // ditto (PDF, CSV … <20 MB)
  functions?: any[]; // optional, for function calling
  function_output?: any;
  function_called?: any; // optional, if a function was called
}

export interface OpenAIOutput {
  aiResponse: string;
  newMemory?: Record<string, any>;
  modal?: string; // model used, e.g., "gpt-4o"
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    input_tokens_details?: {cached_tokens: number}; // optional, if cached tokens were used
  };
  function_call?: any; // optional, if functions were called
  convTopic?: string | null; // conversation topic, if available
}

async function encodeUrl(url: string) {
  const res = await axios.get<ArrayBuffer>(url, { responseType: "arraybuffer" });
  const ct = res.headers["content-type"] || "application/octet-stream";
  return `data:${ct};base64,${Buffer.from(res.data).toString("base64")}`;
}

function transformMessages(originalMessages: any[]) {
  return originalMessages.flatMap((message) => {
    // 1. Function calls or outputs
    if (message.type === "function_call" || message.type === "function_call_output") {
      return {
        type: message.type,
        call_id: message.call_id,
        name: message.name,
        id: message.id,
        arguments: message.arguments,
        output: message.output
      };
    }

    // 2. Regular messages (user, assistant, system)
    let content: string;
    if (Array.isArray(message.content)) {
      content = message.content
        .map((item: any) => item.text?.content || item.text || '')
        .join('\n');
    } else if (typeof message.content === 'object') {
      content = message.content.text?.content || message.content.text || '';
    } else {
      content = message.content || '';
    }

    return {
      role: message.role,
      content: content
    };
  });
}

export async function getOpenAIResData(
  payload: OpenAIInput,
  model = "gpt-4o"
): Promise<OpenAIOutput> {
  const { agentContext, conversationHistory, agentMemory,
    userPrompt, imageUrl, fileUrl, functions, function_called, function_output } = payload;
  const functionsData = functions || [];
  const functionCall = function_output || [];
  const functionCalled = function_called || [];
  const historyMessages = conversationHistory.flatMap(turn => {
    // split on the first “AI:” (works even if AI block has new-lines)
    const [userChunk, aiChunk = ""] = turn.split(/\nAI:\s*/);

    const userText = userChunk.replace(/^User:\s*/, "").trim();
    const aiText = aiChunk.trim();

    return [
      {
        role: "user",
        content: [{ type: "input_text", text: userText }]
      },
      ...(aiText
        ? [{
          role: "assistant",
          content: [{ type: "output_text", text: aiText }]
        }]
        : [])                      // guard in case aiChunk is empty
    ];
  });
  // ── build messages ─────────────────────────────────────────────
  const messages: any[] = [
    {
      role: "system",
      content: [
        { type: "input_text", text: agentContext },
        {
          type: "input_text",
          text: "If you need to save memory or want to return convesation topic for future use about the user like ideas, name and its mandotary, reply ONLY with JSON: " +
            "{\"aiResponse\":\"…\",\"agentMemory\":{…}, \"convTopic\":\"…\"}"
        },
        // ...(functionsData.length>0 ? [{
        //   type: "input_text",
        //   text: `If you need to call a function, reply with JSON: {"tool_uses": [{ "recipient_name": "functionsName", "parameters": {}}, ...]}`
        // }] : [])
      ]
    },
    ...(agentMemory ? [{
      role: "system",
      content: [{
        type: "input_text",
        text: `KNOWN_MEMORY:\n${JSON.stringify(agentMemory)}`
      }]
    }] : []),
    ...historyMessages,
    ...(functionCalled.length > 0
      ? functionCalled.map((func: any) => ({
          type: "function_call",
          id: func.id,
          name: func.name,
          call_id: func.call_id,
          arguments: typeof func.arguments === "string" ? func.arguments : JSON.stringify(func.arguments),
        }))
      : []),

    // ── function call output ─────────────────────────────────────────
    ...(functionCall.length > 0
      ? functionCall.map(({ call_id, data }: { call_id: string; data: any }) => ({
          type: "function_call_output",
          call_id,
          output: JSON.stringify(data, null, 2),
        }))
      : []),
    {
      role: "user",
      content: [
        { type: "input_text", text: userPrompt },
        ...(imageUrl ? [{ type: "input_image", image_url: await encodeUrl(imageUrl) }] : []),
        ...(fileUrl ? [{ type: "input_file", filename: path.basename(fileUrl), file_data: await encodeUrl(fileUrl) }] : [])
      ]
    }
  ];
  // ── transform messages to OpenAI format ───────────────────────
  const transformedMessages = transformMessages(messages);

  let payloadData = JSON.stringify({
    model: model,
    input: transformedMessages,
    text: {
      format: {
        type: "text"
      }
    },
    reasoning: {},
    tools: functionsData,
    tool_choice: "auto",
    temperature: 0.7,
    max_output_tokens: 2048,
    top_p: 1,
    store: true,
  })

  let config = {
    method: 'post',
    maxBodyLength: Infinity,
    url: 'https://api.openai.com/v1/responses',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
    },
    data: payloadData
  };
  // ── axios POST to /chat/completions ────────────────────────────
  let responseData: any = null;
  await axios.request(config)
    .then((response) => {
      responseData = response.data;
      console.log(JSON.stringify(response.data));
    })
    .catch((error) => {
      console.log(JSON.stringify(error.response.data));
    });

  const raw = (responseData.output?.[0]?.content?.[0].text ?? "").trim();

  // ── memory extraction ─────────────────────────────────────────
  let parsed: any = null;
  try { parsed = JSON.parse(raw); } catch { /* plain text */ }
  let functionsArgs: any[] = [];
  if(responseData.output?.[0]?.type === "function_call") {
   functionsArgs = responseData.output;
}
  const usage = responseData?.usage || null;

  return {
    aiResponse: parsed?.aiResponse ?? raw,
    newMemory: parsed?.agentMemory,
    convTopic: parsed?.topic || null,
    modal: model,
    function_call: functionsArgs,
    usage
  };
}