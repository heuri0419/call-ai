import { EDGE_FUNCTION_NAME } from "./constants.js";

export async function callRunScriptFunction({
  supabaseUrl,
  anonKey,
  model,
  vectorStoreId,
  systemPrompt,
  context,
  input,
}) {
  const baseUrl = supabaseUrl.replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/functions/v1/${EDGE_FUNCTION_NAME}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      vector_store_id: vectorStoreId,
      system_prompt: systemPrompt,
      context,
      input,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const message = typeof data.error === "string"
      ? data.error
      : data.error?.message || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data.responseText || "(empty response)";
}
