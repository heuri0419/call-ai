import { createBrowserStorageAdapter } from "./browserStorageAdapter.js";
import { exportDatabases } from "./exportAdapter.js";
import { createProviderClient } from "./providerClient.js";
import {
  activeProfile,
  appendNode,
  buildContext,
  conversationIndex,
  conversationSettings,
  contentToText,
  createEmptyConversation,
  createPromptVersion,
  firstConversationId,
  getActiveConversation,
  syncConversationSettings,
  switchPromptVersion,
  titleFromInput,
  touchContentDb,
} from "./chatDomain.js";
import { getElements, openPromptEditor, renderApp, renderModelChoices, renderPresetChoices, setStatus } from "./ui.js";

const storage = createBrowserStorageAdapter();
const els = getElements();

let { contentDb, userDb, session } = storage.load();
let activeConversationId = session.active_conversation_id || firstConversationId(contentDb);
let editingNodeId = null;
let loadedModels = [];
let loadedPresets = [];
let isSidebarOpen = session.is_sidebar_open !== false;

const initialProfile = activeProfile(userDb);
initialProfile.supabase ||= {};
initialProfile.supabase.jwt = session.supabase_jwt || initialProfile.supabase.jwt || "";

if (!getActiveConversation(contentDb, activeConversationId)) {
  activeConversationId = firstConversationId(contentDb);
}

els.sidebarToggleButton.addEventListener("click", toggleSidebar);
els.sidebarRefreshButton.addEventListener("click", refreshConversationList);
els.newConversationButton.addEventListener("click", createConversationFromButton);
els.profileForm.addEventListener("submit", saveProfile);
els.supabaseLoginButton.addEventListener("click", loginWithSupabasePassword);
els.modelProviderSelect.addEventListener("change", handleModelProviderChange);
els.vectorStoreAliasesInput.addEventListener("input", refreshVectorStoreChoices);
els.loadModelsButton.addEventListener("click", loadModelChoices);
els.modelFilterSelect.addEventListener("change", refreshModelChoices);
els.modelSelect.addEventListener("change", applySelectedModel);
els.systemPromptPresetSelect.addEventListener("change", applySelectedPreset);
els.loadPresetsButton.addEventListener("click", loadSystemPromptPresets);
els.savePresetButton.addEventListener("click", saveSystemPromptPreset);
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
    conversations: conversationIndex(contentDb),
    activeConversationId,
    isSidebarOpen,
    presets: loadedPresets,
    onSelectConversation: selectConversation,
    onNewConversation: createConversationFromButton,
    onEditPrompt: handleEditPrompt,
    onSwitchPromptVersion: handleSwitchPromptVersion,
  });
}

function activeConversation() {
  return getActiveConversation(contentDb, activeConversationId);
}

function persist() {
  storage.save({ contentDb, userDb });
  persistSession();
}

function persistSession() {
  const profile = activeProfile(userDb);
  storage.saveSession({
    active_conversation_id: activeConversationId || "",
    is_sidebar_open: isSidebarOpen,
    supabase_jwt: profile.supabase?.jwt || "",
  });
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
  const settings = settingsFromForm(profile);
  if (!supabase.url) return setStatus(els, "missing Supabase URL");
  if (!supabase.anon_key) return setStatus(els, "missing Supabase anon key");
  if (!settings.model) return setStatus(els, "missing model");

  const conversation = activeConversation() || createConversation(profile);
  syncConversationSettings(conversation, settings);
  if (!conversation.current_node) conversation.title = titleFromInput(input);
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
      provider: settings.model_provider,
      model: settings.model,
      vectorStoreNames: settings.model_provider === "openai" ? settings.vector_store_names : [],
      systemPrompt: settings.system_prompt,
      context: buildContext(conversation, profile.script?.context_node_limit || 6),
      input,
    });
    const assistantNode = appendNode(conversation, "assistant", output, settings.model);
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

function applySelectedPreset() {
  const preset = loadedPresets.find((item) => item.id === els.systemPromptPresetSelect.value);
  if (!preset) {
    els.systemPromptPresetNameInput.value = "";
    saveActiveConversationSettings({});
    setStatus(els, "preset link cleared");
    return;
  }
  els.systemPromptInput.value = preset.content || "";
  els.systemPromptPresetNameInput.value = preset.name || "";
  if (preset.provider && preset.provider !== "all") els.modelProviderSelect.value = preset.provider;
  if (preset.model_hint) els.modelInput.value = preset.model_hint;
  saveActiveConversationSettings();
  setStatus(els, `preset applied: ${preset.name}`);
}

async function loadSystemPromptPresets() {
  const profile = activeProfile(userDb);
  els.loadPresetsButton.disabled = true;
  setStatus(els, "loading system prompt presets");
  try {
    loadedPresets = await createProviderClient(profile).listSystemPromptPresets();
    const selectedId = conversationSettings(activeConversation(), profile).system_prompt_preset_id;
    renderPresetChoices(els, loadedPresets, selectedId);
    setStatus(els, loadedPresets.length ? `loaded ${loadedPresets.length} presets` : "no presets returned");
  } catch (error) {
    setStatus(els, `preset load failed: ${error.message}`);
  } finally {
    els.loadPresetsButton.disabled = false;
  }
}

async function saveSystemPromptPreset() {
  const profile = activeProfile(userDb);
  const name = els.systemPromptPresetNameInput.value.trim();
  const content = els.systemPromptInput.value.trim();
  if (!name) return setStatus(els, "preset name is empty");
  if (!content) return setStatus(els, "system prompt is empty");

  els.savePresetButton.disabled = true;
  setStatus(els, "saving system prompt preset");
  try {
    const created = await createProviderClient(profile).createSystemPromptPreset({
      name,
      content,
      provider: normalizedModelProvider(els.modelProviderSelect.value),
      modelHint: els.modelInput.value.trim(),
    });
    loadedPresets = [...loadedPresets.filter((item) => item.id !== created[0]?.id), ...created]
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    if (created[0]?.id) els.systemPromptPresetSelect.value = created[0].id;
    saveActiveConversationSettings(created[0] || null);
    setStatus(els, `preset saved: ${name}`);
  } catch (error) {
    setStatus(els, `preset save failed: ${error.message}`);
  } finally {
    els.savePresetButton.disabled = false;
  }
}

function createConversation(profile) {
  const conversation = createEmptyConversation(contentDb, profile);
  activeConversationId = conversation.id;
  persistSession();
  return conversation;
}

function createConversationFromButton() {
  const conversation = createConversation(activeProfile(userDb));
  touchContentDb(contentDb, conversation);
  persist();
  render();
  setStatus(els, "new conversation ready");
}

function selectConversation(conversationId) {
  if (!contentDb.conversations?.[conversationId]) return;
  activeConversationId = conversationId;
  persistSession();
  render();
  setStatus(els, "conversation selected");
}

function toggleSidebar() {
  isSidebarOpen = !isSidebarOpen;
  persistSession();
  render();
}

function refreshConversationList() {
  contentDb.conversation_index = conversationIndex(contentDb);
  persist();
  render();
  setStatus(els, "conversation list refreshed from local cache");
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
  profile.script.name = selectedPreset()?.name || "";
  saveActiveConversationSettings();
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
    const authSession = await requestSupabasePasswordSession({ supabaseUrl, anonKey, email, password });
    if (!authSession.access_token) throw new Error("Supabase did not return an access token.");

    profile.supabase.url = supabaseUrl;
    profile.supabase.anon_key = anonKey;
    profile.supabase.jwt = authSession.access_token;
    userDb.updated_at = new Date().toISOString();
    persist();

    els.supabasePasswordInput.value = "";
    els.supabaseJwtInput.value = "";
    els.profileStatus.textContent = authSession.user?.email ? `logged in as ${authSession.user.email}` : "JWT saved";
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
  ({ contentDb, userDb, session } = storage.reset());
  activeConversationId = firstConversationId(contentDb);
  isSidebarOpen = true;
  render();
  setStatus(els, "empty database reloaded");
}

function handleModelProviderChange() {
  loadedModels = [];
  refreshModelChoices();
  saveActiveConversationSettings();
}

function selectedModelProvider(profile) {
  const modelProvider = normalizedModelProvider(els.modelProviderSelect.value || profile.model_provider);
  return modelProvider;
}

function settingsFromForm(profile, presetOverride = null) {
  const preset = presetOverride || selectedPreset();
  const vectorStoreName = els.activeVectorStoreSelect.value.trim();
  return {
    model_provider: selectedModelProvider(profile),
    model: els.modelInput.value.trim(),
    vector_store_names: vectorStoreName ? [vectorStoreName] : [],
    system_prompt: els.systemPromptInput.value.trim(),
    system_prompt_preset_id: preset?.id || "",
    system_prompt_preset_name: preset?.name || "",
  };
}

function selectedPreset() {
  return loadedPresets.find((item) => item.id === els.systemPromptPresetSelect.value) || null;
}

function saveActiveConversationSettings(presetOverride = null) {
  const profile = activeProfile(userDb);
  const conversation = activeConversation();
  if (!conversation) return;
  syncConversationSettings(conversation, settingsFromForm(profile, presetOverride));
  touchContentDb(contentDb, conversation);
  persist();
  render();
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
