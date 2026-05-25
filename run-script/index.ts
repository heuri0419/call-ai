const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type RunScriptRequest = {
  model?: string;
  vector_store_id?: string;
  system_prompt?: string;
  context?: string;
  input?: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiApiKey) {
      return json({ error: "OPENAI_API_KEY is not configured in Supabase secrets." }, 500);
    }

    const body = (await req.json()) as RunScriptRequest;
    const input = String(body.input || "").trim();
    if (!input) {
      return json({ error: "input is required." }, 400);
    }

    const model = String(body.model || Deno.env.get("DEFAULT_MODEL") || "gpt-4.1-mini").trim();
    const vectorStoreId = String(body.vector_store_id || Deno.env.get("VECTOR_STORE_ID") || "").trim();
    const systemPrompt = String(body.system_prompt || "You are a careful assistant.").trim();
    const context = String(body.context || "").trim();

    const payload: Record<string, unknown> = {
      model,
      input: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: ["Local context:", context || "(empty)", "", "User input:", input].join("\n"),
        },
      ],
    };

    if (vectorStoreId) {
      payload.tools = [{ type: "file_search", vector_store_ids: [vectorStoreId] }];
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return json(
        {
          error: data?.error?.message || `OpenAI request failed with status ${response.status}.`,
          raw: data,
        },
        response.status,
      );
    }

    return json({
      ok: true,
      responseText: extractResponseText(data),
      raw: data,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

function extractResponseText(data: any): string {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text;
  }

  const parts: string[] = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") parts.push(content.text);
    }
  }

  return parts.join("\n").trim() || "(empty response)";
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
