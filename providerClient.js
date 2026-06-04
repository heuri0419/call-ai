import { EDGE_FUNCTION_NAME } from "./constants.js";

export function createProviderClient(profile) {
  const supabase = profile.supabase || {};
  return createSupabaseOpenAiClient({
    supabaseUrl: supabase.url || "",
    anonKey: supabase.anon_key || "",
    jwt: supabase.jwt || "",
  });
}

function createSupabaseOpenAiClient({ supabaseUrl, anonKey, jwt }) {
  return {
    async runScript({ provider, model, vectorStoreNames, systemPrompt, context, input }) {
      const data = await callEdgeFunction({
        supabaseUrl,
        anonKey,
        jwt,
        body: {
          action: "run-script",
          provider,
          model,
          vector_store_names: vectorStoreNames,
          system_prompt: systemPrompt,
          context,
          input,
        },
      });
      return data.responseText || "(empty response)";
    },

    async listModels({ provider } = {}) {
      const data = await callEdgeFunction({
        supabaseUrl,
        anonKey,
        jwt,
        body: { action: "list-models", provider },
      });
      const requestedProvider = provider || "openai";
      const returnedProvider = data.provider || "openai";
      if (returnedProvider !== requestedProvider) {
        throw new Error(
          `Requested ${requestedProvider} models but the Edge Function returned ${returnedProvider}. Redeploy run-script.`,
        );
      }
      return normalizeModels(Array.isArray(data.models) ? data.models : [], returnedProvider);
    },

    async listSystemPromptPresets() {
      return callSupabaseRest({
        supabaseUrl,
        anonKey,
        jwt,
        path: "system_prompt_presets?select=id,name,content,provider,model_hint,is_default&order=name.asc",
      });
    },

    async createSystemPromptPreset({ name, content, provider, modelHint }) {
      return callSupabaseRest({
        supabaseUrl,
        anonKey,
        jwt,
        path: "system_prompt_presets",
        method: "POST",
        body: {
          name,
          content,
          provider: provider || "all",
          model_hint: modelHint || null,
        },
        prefer: "return=representation",
      });
    },
  };
}

async function callEdgeFunction({ supabaseUrl, anonKey, jwt, body }) {
  if (!supabaseUrl) throw new Error("missing Supabase URL");
  if (!anonKey) throw new Error("missing Supabase anon key");

  const baseUrl = supabaseUrl.replace(/\/+$/, "");
  const headers = {
    apikey: anonKey,
    "Content-Type": "application/json",
  };
  if (jwt) headers.Authorization = `Bearer ${jwt}`;

  const response = await fetch(`${baseUrl}/functions/v1/${EDGE_FUNCTION_NAME}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const message = typeof data.error === "string" ? data.error : data.error?.message || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}

async function callSupabaseRest({ supabaseUrl, anonKey, jwt, path, method = "GET", body, prefer }) {
  if (!supabaseUrl) throw new Error("missing Supabase URL");
  if (!anonKey) throw new Error("missing Supabase anon key");
  if (!jwt) throw new Error("Log in for JWT before using cloud presets.");

  const baseUrl = supabaseUrl.replace(/\/+$/, "");
  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${jwt}`,
    "Content-Type": "application/json",
  };
  if (prefer) headers.Prefer = prefer;

  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => []);
  if (!response.ok) {
    throw new Error(data?.message || data?.hint || `Preset request failed with HTTP ${response.status}`);
  }
  return Array.isArray(data) ? data : [];
}

function normalizeModels(models, provider) {
  return models.map((model) => {
    const id = String(model.id || "");
    const category = provider === "grok" ? classifyGrokModel(id) : classifyOpenAiModel(id);
    return {
      id,
      owned_by: String(model.owned_by || ""),
      provider,
      category,
      is_fine_tuned: id.startsWith("ft:"),
      is_text_candidate: category === "text" || category === "fine-tuned",
    };
  });
}

function classifyGrokModel(id) {
  if (/(imagine|image-generation|video|voice|tts|speech)/i.test(id)) return "media";
  if (/grok/i.test(id)) return "text";
  return "other";
}

function classifyOpenAiModel(id) {
  if (id.startsWith("ft:")) return "fine-tuned";
  if (/(embedding|moderation)/i.test(id)) return "utility";
  if (/(image|sora)/i.test(id)) return "image";
  if (/(audio|tts|whisper|transcribe|realtime)/i.test(id)) return "audio";
  if (/^(babbage|davinci)-002$/i.test(id)) return "legacy";
  if (/search-preview|search-api/i.test(id)) return "search";
  if (/^(gpt|o\d|chat-latest)/i.test(id)) return "text";
  return "other";
}
