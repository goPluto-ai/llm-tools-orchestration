import axios from "axios";
import path from "path";

export interface OpenAIInput {
  agentContext: string;
  conversationHistory: string[];
  agentMemory: Record<string, any> | null;
  userPrompt: string;
  imageUrl?: string;
  fileUrl?: string;
  functions?: any[];
  function_output?: any;
}

export interface OpenAIOutput {
  aiResponse: string;
  newMemory?: Record<string, any>;
  modal?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    input_tokens_details?: { cached_tokens: number };
  };
  function_call?: any;
  convTopic?: string | null;
}

async function encodeUrl(url: string) {
  const res = await axios.get<ArrayBuffer>(url, { responseType: "arraybuffer" });
  const ct = res.headers["content-type"] || "application/octet-stream";
  return `data:${ct};base64,${Buffer.from(res.data).toString("base64")}`;
}

function transformMessages(originalMessages: any[]) {
  return originalMessages.map(message => {
    let content: string;
    if (Array.isArray(message.content)) {
      content = message.content
        .map((item: any) => item.text?.content || item.text || '')
        .join('\n');
    } else if (typeof message.content === 'object') {
      content = message.content.text?.content || message.content.text || '';
    } else {
      content = message.content;
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
  const {
    agentContext, conversationHistory, agentMemory,
    userPrompt, imageUrl, fileUrl, functions, function_output
  } = payload;
  const functionsData = functions || [];
  const functionCall = function_output || [];
  const historyMessages = conversationHistory.flatMap(turn => {
    const [userChunk, aiChunk = ""] = turn.split(/\nAI:\s*/);
    const userText = userChunk.replace(/^User:\s*/, "").trim();
    const aiText = aiChunk.trim();

    return [
      { role: "user", content: [{ type: "input_text", text: userText }] },
      ...(aiText ? [{
        role: "assistant",
        content: [{ type: "output_text", text: aiText }]
      }] : [])
    ];
  });

  const messages: any[] = [
    {
      role: "system",
      content: [
        { type: "input_text", text: agentContext },
        {
          type: "input_text",
          text: "If you need to save memory or want to return convesation topic for future use about the user like ideas, name and its mandotary, reply ONLY with JSON: " +
            "{\"aiResponse\":\"…\",\"agentMemory\":{…}, \"convTopic\":\"…\"}"
        }
      ]
    },
    ...(agentMemory ? [{
      role: "system",
      content: [{ type: "input_text", text: `KNOWN_MEMORY:\n${JSON.stringify(agentMemory)}` }]
    }] : []),
    ...historyMessages,
    ...functionCall.length > 0 ? [{
      role: "function",
      name: functionCall.recipient_name,
      content: [{ type: "output_text", text: JSON.stringify(functionCall.data) }]
    }] : [],
    {
      role: "user",
      content: [
        { type: "input_text", text: userPrompt },
        ...(imageUrl ? [{ type: "input_image", image_url: await encodeUrl(imageUrl) }] : []),
        ...(fileUrl ? [{ type: "input_file", filename: path.basename(fileUrl), file_data: await encodeUrl(fileUrl) }] : [])
      ]
    }
  ];

  const transformedMessages = transformMessages(messages);

  let payloadData = JSON.stringify({
    model: model,
    input: transformedMessages,
    text: { format: { type: "text" } },
    reasoning: {},
    tools: functionsData,
    tool_choice: "auto",
    temperature: 0.7,
    max_output_tokens: 2048,
    top_p: 1,
    store: true,
  });

  const config = {
    method: 'post',
    maxBodyLength: Infinity,
    url: 'https://api.openai.com/v1/responses',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
    },
    data: payloadData
  };

  let responseData: any = null;
  await axios.request(config)
    .then(response => responseData = response.data)
    .catch(error => {
      console.log(JSON.stringify(error.response.data));
    });

  const raw = (responseData.output?.[0]?.content?.[0].text ?? "").trim();
  let parsed: any = null;
  try { parsed = JSON.parse(raw); } catch { }

  let functionsArgs: any[] = [];
  if (responseData.output?.[0]?.type === "function_call") {
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
