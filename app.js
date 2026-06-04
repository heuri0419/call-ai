import { createBrowserStorageAdapter } from "./browserStorageAdapter.js";
import { exportDatabases } from "./exportAdapter.js";
import { createProviderClient } from "./providerClient.js";
import {
  activeProfile,
  appendNode,
  buildContext,
  contentToText,
  createEmptyConversation,
  createPromptVersion,
  firstConversationId,
  getActiveConversation,
  switchPromptVersion,
  touchContentDb,
} from "./chatDomain.js";
import { activeVectorStoreAlias, getElements, openPromptEditor, renderApp, renderModelChoices, setStatus } from "./ui.js";

const storage = createBrowserStorageAdapter();
const els = getElements();

let { contentDb, userDb } = storage.load();
let activeConversationId = firstConversationId(contentDb);
let editingNodeId = null;
let loadedModels = [];

els.profileForm.addEventListener("submit", saveProfile);
els.supabaseLoginButton.addEventListener("click", loginWithSupabasePassword);
els.modelProviderSelect.addEventListener("change", handleModelProviderChange);
els.vectorStoreAliasesInput.addEventListener("input", refreshVectorStoreChoices);
els.loadModelsButton.addEventListener("click", loadModelChoices);
els.modelFilterSelect.addEventListener("change", refreshModelChoices);
els.modelSelect.addEventListener("change", applySelectedModel);
els.runForm.addEventListener("submit", runScript);
els.exportButton.addEventListener("click", () => {
  exportDatabases({ contentDb, userDb });
  setStatus(els, "exported");
});
els.resetButton.addEventListener("click", resetLocalDatabases);
els.saveEditButton.addEventListener("click", savePromptVersion);

persist();
render();
setStatus(els, "ready");

function render() {
  renderApp(els, {
    profile: activeProfile(userDb),
    conversation: activeConversation(),
    onEditPrompt: handleEditPrompt,
    onSwitchPromptVersion: handleSwitchPromptVersion,
  });
}

function activeConversation() {
  return getActiveConversation(contentDb, activeConversationId);
}

function persist() {
  storage.save({ contentDb, userDb });
}

function handleEditPrompt(nodeId) {
  const conversation = activeConversation();
  editingNodeId = nodeId;
  openPromptEditor(els, contentToText(conversation.mapping[nodeId].message.content));
}

function savePromptVersion() {
  const conversation = activeConversation();
  if (!conversation) return;
  const node = createPromptVersion(conversation, editingNodeId, els.editPromptInput.value);
  if (!node) return;
  touchContentDb(contentDb, conversation);
  persist();
  els.editDialog.close();
  render();
  setStatus(els, "prompt version saved");
}

function handleSwitchPromptVersion(nodeId) {
  const conversation = activeConversation();
  if (!conversation || !nodeId) return;
  switchPromptVersion(conversation, nodeId);
  touchContentDb(contentDb, conversation);
  persist();
  render();
}

async function runScript(event) {
  event.preventDefault();
  const input = els.inputBox.value.trim();
  if (!input) return setStatus(els, "input is empty");

  const profile = activeProfile(userDb);
  const supabase = profile.supabase || {};
  const openai = profile.openai || {};
  const modelProvider = selectedModelProvider(profile);
  if (!supabase.url) return setStatus(els, "missing Supabase URL");
  if (!supabase.anon_key) return setStatus(els, "missing Supabase anon key");
  if (!openai.model) return setStatus(els, "missing model");

  const conversation = activeConversation() || createConversation(profile);
  const userNode = appendNode(conversation, "user", input, null);
  conversation.current_node = userNode.id;
  touchContentDb(contentDb, conversation);
  persist();
  render();

  els.runButton.disabled = true;
  setStatus(els, "calling Supabase Edge Function");
  try {
    const provider = createProviderClient(profile);
    const output = await provider.runScript({
      provider: modelProvider,
      model: openai.model,
      vectorStoreNames: selectedVectorStoreNames(profile),
      systemPrompt: profile.script?.system_prompt || "",
      context: buildContext(conversation, profile.script?.context_node_limit || 6),
      input,
    });
    const assistantNode = appendNode(conversation, "assistant", output, openai.model);
    conversation.current_node = assistantNode.id;
    touchContentDb(contentDb, conversation);
    persist();
    els.inputBox.value = "";
    render();
    setStatus(els, "reply saved");
  } catch (error) {
    setStatus(els, `call failed: ${error.message}`);
  } finally {
    els.runButton.disabled = false;
  }
}

async function loadModelChoices() {
  const profile = activeProfile(userDb);
  const supabase = profile.supabase || {};
  const modelProvider = selectedModelProvider(profile);
  if (!supabase.url) return setStatus(els, "missing Supabase URL");
  if (!supabase.anon_key) return setStatus(els, "missing Supabase anon key");

  els.loadModelsButton.disabled = true;
  setStatus(els, `loading ${modelProvider} models`);
  try {
    const provider = createProviderClient(profile);
    loadedModels = await provider.listModels({ provider: modelProvider });
    refreshModelChoices();
    setStatus(els, loadedModels.length ? `loaded ${loadedModels.length} models` : "no models returned");
  } catch (error) {
    setStatus(els, `model list failed: ${error.message}`);
  } finally {
    els.loadModelsButton.disabled = false;
  }
}

function refreshModelChoices() {
  renderModelChoices(els, loadedModels, els.modelFilterSelect.value);
}

function applySelectedModel() {
  if (!els.modelSelect.value) return;
  els.modelInput.value = els.modelSelect.value;
}

function createConversation(profile) {
  const conversation = createEmptyConversation(contentDb, profile);
  activeConversationId = conversation.id;
  return conversation;
}

function saveProfile(event) {
  event.preventDefault();
  const profile = activeProfile(userDb);
  profile.provider = "supabase-edge";
  profile.supabase ||= {};
  profile.openai ||= {};

  const anonKey = els.supabaseAnonKeyInput.value.trim();
  const jwt = els.supabaseJwtInput.value.trim();
  profile.supabase.url = els.supabaseUrlInput.value.trim();
  if (anonKey) profile.supabase.anon_key = anonKey;
  if (jwt) profile.supabase.jwt = jwt;
  profile.model_provider = normalizedModelProvider(els.modelProviderSelect.value);
  profile.openai.model = els.modelInput.value.trim();
  profile.openai.vector_store_aliases = parseVectorStoreAliases(els.vectorStoreAliasesInput.value);
  profile.openai.active_vector_store_alias = profile.openai.vector_store_aliases.includes(els.activeVectorStoreSelect.value)
    ? els.activeVectorStoreSelect.value
    : "";
  delete profile.openai.vector_store_id;
  delete profile.openai.vector_store_name;
  delete profile.openai.vector_store_names;
  delete profile.openai.active_vector_store_name;
  profile.script ||= {};
  profile.script.system_prompt = els.systemPromptInput.value.trim();
  userDb.updated_at = new Date().toISOString();
  persist();
  els.supabaseAnonKeyInput.value = "";
  els.supabaseJwtInput.value = "";
  els.supabasePasswordInput.value = "";
  els.profileStatus.textContent = "saved in browser storage";
  render();
}

async function loginWithSupabasePassword() {
  const profile = activeProfile(userDb);
  profile.supabase ||= {};

  const supabaseUrl = els.supabaseUrlInput.value.trim() || profile.supabase.url || "";
  const anonKey = els.supabaseAnonKeyInput.value.trim() || profile.supabase.anon_key || "";
  const email = els.supabaseEmailInput.value.trim();
  const password = els.supabasePasswordInput.value;

  if (!supabaseUrl) return setStatus(els, "missing Supabase URL");
  if (!anonKey) return setStatus(els, "missing Supabase anon key");
  if (!email) return setStatus(els, "missing Supabase email");
  if (!password) return setStatus(els, "missing Supabase password");

  els.supabaseLoginButton.disabled = true;
  setStatus(els, "requesting Supabase user JWT");
  try {
    const session = await requestSupabasePasswordSession({ supabaseUrl, anonKey, email, password });
    if (!session.access_token) throw new Error("Supabase did not return an access token.");

    profile.supabase.url = supabaseUrl;
    profile.supabase.anon_key = anonKey;
    profile.supabase.jwt = session.access_token;
    userDb.updated_at = new Date().toISOString();
    persist();

    els.supabasePasswordInput.value = "";
    els.supabaseJwtInput.value = "";
    els.profileStatus.textContent = session.user?.email ? `logged in as ${session.user.email}` : "JWT saved";
    render();
    setStatus(els, "Supabase JWT saved");
  } catch (error) {
    setStatus(els, `login failed: ${error.message}`);
  } finally {
    els.supabaseLoginButton.disabled = false;
  }
}

async function requestSupabasePasswordSession({ supabaseUrl, anonKey, email, password }) {
  const baseUrl = supabaseUrl.replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const message = typeof data.error === "string"
      ? data.error
      : data.error_description || data.msg || data.message || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}

function refreshVectorStoreChoices() {
  const currentValue = els.activeVectorStoreSelect.value;
  const aliases = parseVectorStoreAliases(els.vectorStoreAliasesInput.value);
  els.activeVectorStoreSelect.replaceChildren(new Option("None", ""));
  for (const alias of aliases) {
    els.activeVectorStoreSelect.append(new Option(alias, alias));
  }
  els.activeVectorStoreSelect.value = aliases.includes(currentValue) ? currentValue : "";
}

function resetLocalDatabases() {
  if (!window.confirm("Reload empty data and clear this page's browser-local MVP data?")) return;
  ({ contentDb, userDb } = storage.reset());
  activeConversationId = firstConversationId(contentDb);
  render();
  setStatus(els, "empty database reloaded");
}

function handleModelProviderChange() {
  const profile = activeProfile(userDb);
  profile.model_provider = normalizedModelProvider(els.modelProviderSelect.value);
  loadedModels = [];
  refreshModelChoices();
  persist();
  render();
}

function selectedVectorStoreNames(profile) {
  if (activeModelProvider(profile) !== "openai") return [];
  const openai = profile.openai || {};
  const alias = activeVectorStoreAlias(openai);
  return alias ? [alias] : [];
}

function activeModelProvider(profile) {
  return normalizedModelProvider(profile.model_provider);
}

function selectedModelProvider(profile) {
  const modelProvider = normalizedModelProvider(els.modelProviderSelect.value || profile.model_provider);
  profile.model_provider = modelProvider;
  return modelProvider;
}

function normalizedModelProvider(value) {
  return value === "grok" ? "grok" : "openai";
}

function parseVectorStoreAliases(value) {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}
