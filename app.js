import { createBrowserStorageAdapter } from "./browserStorageAdapter.js";
import { exportDatabases } from "./exportAdapter.js";
import { importGrokExport } from "./grokImportAdapter.js";
import { createProviderClient } from "./providerClient.js";
import {
  activeProfile,
  appendNode,
  buildContext,
  conversationIndex,
  conversationSettings,
  conversationSyncState,
  contentToText,
  createEmptyConversation,
  createPromptVersion,
  firstConversationId,
  getActiveConversation,
  markConversationSynced,
  mergeConversationsPreservingParents,
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
let lastMessageScrollTop = 0;
let floatingHeaderVisible = false;

const initialProfile = activeProfile(userDb);
initialProfile.supabase ||= {};
initialProfile.supabase.jwt = session.supabase_jwt || initialProfile.supabase.jwt || "";

if (!getActiveConversation(contentDb, activeConversationId)) {
  activeConversationId = firstConversationId(contentDb);
}

els.sidebarToggleButton.addEventListener("click", toggleSidebar);
els.sidebarRefreshButton.addEventListener("click", refreshConversationList);
els.syncConversationsButton.addEventListener("click", syncCloudConversations);
els.newConversationButton.addEventListener("click", createConversationFromButton);
els.settingsButton.addEventListener("click", openSettings);
els.compactSettingsButton.addEventListener("click", openSettings);
els.floatingSettingsButton.addEventListener("click", openSettings);
els.closeSettingsButton.addEventListener("click", () => closeDialog(els.settingsDialog));
els.chatSettingsButton.addEventListener("click", openChatSettings);
els.floatingChatSettingsButton.addEventListener("click", openChatSettings);
els.closeChatSettingsButton.addEventListener("click", () => closeDialog(els.chatSettingsDialog));
els.chatSettingsForm.addEventListener("submit", saveChatSettings);
els.profileForm.addEventListener("submit", saveProfile);
els.supabaseLoginButton.addEventListener("click", loginWithSupabasePassword);
els.importGrokButton.addEventListener("click", importGrokConversations);
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
els.messageStack.addEventListener("scroll", handleMessageScroll, { passive: true });
els.scrollTopButton.addEventListener("click", () => scrollMessagesTo("top"));
els.scrollBottomButton.addEventListener("click", () => scrollMessagesTo("bottom"));
window.addEventListener("resize", updateFloatingLayout, { passive: true });

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
  updateFloatingLayout();
  updateScrollChrome();
}

function handleMessageScroll() {
  const currentTop = els.messageStack.scrollTop;
  const direction = currentTop < lastMessageScrollTop ? "up" : currentTop > lastMessageScrollTop ? "down" : "still";
  lastMessageScrollTop = currentTop;
  updateScrollChrome(direction);
}

function scrollMessagesTo(target) {
  const top = target === "top" ? 0 : els.messageStack.scrollHeight;
  els.messageStack.scrollTo({ top, behavior: "smooth" });
  floatingHeaderVisible = target === "top" ? false : floatingHeaderVisible;
  updateScrollChrome();
}

function updateFloatingLayout() {
  document.documentElement.style.setProperty("--composer-height", `${Math.ceil(els.runForm.offsetHeight || 96)}px`);
  document.documentElement.style.setProperty("--status-height", `${Math.ceil(els.statusLine.offsetHeight || 40)}px`);
}

function updateScrollChrome(direction = "still") {
  const maxScroll = Math.max(0, els.messageStack.scrollHeight - els.messageStack.clientHeight);
  const currentTop = els.messageStack.scrollTop;
  const canScroll = maxScroll > 12;
  const nearTop = currentTop <= 10;
  const nearBottom = currentTop >= maxScroll - 10;

  els.scrollRail.dataset.visible = canScroll ? "true" : "false";
  els.scrollTopButton.disabled = !canScroll || nearTop;
  els.scrollBottomButton.disabled = !canScroll || nearBottom;

  if (!canScroll || nearTop || direction === "down") floatingHeaderVisible = false;
  if (canScroll && currentTop > 96 && direction === "up") floatingHeaderVisible = true;

  els.floatingTopbar.dataset.visible = floatingHeaderVisible ? "true" : "false";
  els.floatingTopbar.setAttribute("aria-hidden", floatingHeaderVisible ? "false" : "true");
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
    supabase_refresh_token: session.supabase_refresh_token || "",
    supabase_expires_at: session.supabase_expires_at || 0,
  });
}

function handleEditPrompt(nodeId) {
  const conversation = activeConversation();
  editingNodeId = nodeId;
  openPromptEditor(els, contentToText(conversation.mapping[nodeId].message.content));
}

async function savePromptVersion() {
  const conversation = activeConversation();
  if (!conversation) return;
  const node = createPromptVersion(conversation, editingNodeId, els.editPromptInput.value);
  if (!node) return;
  touchContentDb(contentDb, conversation);
  persist();
  closeDialog(els.editDialog);
  render();
  setStatus(els, "prompt version saved; regenerating reply");
  await generateReplyForCurrentPrompt(contentToText(node.message.content));
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

  let conversation = activeConversation() || createConversation(profile);
  syncConversationSettings(conversation, settings);
  if (!conversation.current_node) conversation.title = titleFromInput(input);
  const userNode = appendNode(conversation, "user", input, null);
  conversation.current_node = userNode.id;
  touchContentDb(contentDb, conversation);
  persist();
  render();

  await generateReplyForCurrentPrompt(input, { clearInput: true });
}

async function generateReplyForCurrentPrompt(input, { clearInput = false } = {}) {
  const profile = activeProfile(userDb);
  const settings = settingsFromForm(profile);
  let conversation = activeConversation();
  if (!conversation) return setStatus(els, "no active conversation");

  els.runButton.disabled = true;
  els.saveEditButton.disabled = true;
  try {
    await refreshSupabaseJwtIfNeeded(profile);
    const provider = createProviderClient(profile);
    if (profile.supabase?.jwt) {
      setStatus(els, "saving prompt to cloud before model call");
      const promptSync = await syncConversationSnapshot(provider, conversation);
      persist();
      render();
      if (!promptSync.ok) {
        setStatus(els, "prompt saved locally, cloud sync failed; model call stopped");
        return;
      }
      conversation = activeConversation();
    }

    setStatus(els, "calling Supabase Edge Function");
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

    if (profile.supabase?.jwt) {
      setStatus(els, "saving reply to cloud");
      const replySync = await syncConversationSnapshot(provider, conversation);
      persist();
      render();
      if (clearInput) els.inputBox.value = "";
      if (!replySync.ok) {
        setStatus(els, "reply saved locally, cloud sync failed");
        return;
      }
      setStatus(els, "reply saved and synced");
      return;
    }

    if (clearInput) els.inputBox.value = "";
    render();
    setStatus(els, "reply saved");
  } catch (error) {
    setStatus(els, `call failed: ${error.message}`);
  } finally {
    els.runButton.disabled = false;
    els.saveEditButton.disabled = false;
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
    await refreshSupabaseJwtIfNeeded(profile);
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
    await refreshSupabaseJwtIfNeeded(profile);
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
    await refreshSupabaseJwtIfNeeded(profile);
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

async function importGrokConversations() {
  const file = els.grokExportFileInput.files?.[0];
  if (!file) return setStatus(els, "choose prod-grok-backend.json first");

  els.importGrokButton.disabled = true;
  setStatus(els, "reading Grok export locally");
  try {
    const data = JSON.parse(await file.text());
    const result = importGrokExport(data, contentDb.conversations || {});
    for (const conversation of result.conversations) {
      contentDb.conversations[conversation.id] = conversation;
    }
    contentDb.updated_at = new Date().toISOString();
    contentDb.conversation_index = conversationIndex(contentDb);
    if (result.conversations[0]) activeConversationId = result.conversations[0].id;
    persist();
    render();
    els.grokExportFileInput.value = "";
    setStatus(
      els,
      `Grok import complete: ${result.added} added / ${result.updated} updated / ${result.unchanged} unchanged / ${result.rejected} rejected`,
    );
  } catch (error) {
    setStatus(els, `Grok import failed: ${error.message}`);
  } finally {
    els.importGrokButton.disabled = false;
  }
}

async function syncCloudConversations() {
  const profile = activeProfile(userDb);
  const supabase = profile.supabase || {};
  if (!supabase.url) return setStatus(els, "missing Supabase URL");
  if (!supabase.anon_key) return setStatus(els, "missing Supabase anon key");
  if (!supabase.jwt) return setStatus(els, "Log in for JWT before syncing conversations");

  els.syncConversationsButton.disabled = true;
  setStatus(els, "syncing conversations");
  try {
    await refreshSupabaseJwtIfNeeded(profile);
    const provider = createProviderClient(profile);
    const remoteRows = await provider.listCloudConversations();
    const remoteById = new Map(remoteRows.map((row) => [row.conversation_id, row]));
    const result = { uploaded: 0, downloaded: 0, merged: 0, conflicts: 0 };

    for (const conversation of Object.values(contentDb.conversations || {})) {
      const remote = remoteById.get(conversation.id);
      if (!remote) {
        const saved = await syncConversationSnapshot(provider, conversation);
        if (saved.ok) {
          result.uploaded += 1;
        } else {
          result.conflicts += 1;
        }
        continue;
      }

      remoteById.delete(conversation.id);
      const localSync = conversationSyncState(conversation);
      const remoteVersion = Number(remote.version) || 0;
      if (localSync.version === remoteVersion && localSync.dirty) {
        const saved = await syncConversationSnapshot(provider, conversation);
        if (saved.ok && saved.merged) result.merged += 1;
        else if (saved.ok) result.uploaded += 1;
        else result.conflicts += 1;
      } else if (localSync.version < remoteVersion && !localSync.dirty) {
        if (replaceConversationFromCloud(remote)) result.downloaded += 1;
        else result.conflicts += 1;
      } else if (localSync.version !== remoteVersion) {
        if (await mergeAndSaveConflict(provider, conversation, remote)) result.merged += 1;
        else result.conflicts += 1;
      }
    }

    for (const remote of remoteById.values()) {
      if (replaceConversationFromCloud(remote)) result.downloaded += 1;
      else result.conflicts += 1;
    }

    contentDb.conversation_index = conversationIndex(contentDb);
    if (!activeConversation() && contentDb.conversation_index[0]?.id) {
      activeConversationId = contentDb.conversation_index[0].id;
    }
    persist();
    render();
    setStatus(
      els,
      `sync complete: ${result.uploaded} uploaded / ${result.downloaded} downloaded / ${result.merged} merged / ${result.conflicts} conflicts`,
    );
  } catch (error) {
    setStatus(els, `sync failed: ${error.message}`);
  } finally {
    els.syncConversationsButton.disabled = false;
  }
}

async function syncConversationSnapshot(provider, conversation) {
  const localVersion = conversationSyncState(conversation).version;
  const saved = await provider.saveCloudConversation(conversation, localVersion);
  if (!saved.conflict && saved.row) {
    markConversationSynced(conversation, saved.row.version);
    return { ok: true, merged: false };
  }
  return {
    ok: await mergeAndSaveConflict(provider, conversation, saved.row),
    merged: true,
  };
}

async function mergeAndSaveConflict(provider, localConversation, remoteRow) {
  const remoteConversation = remoteRow?.payload;
  const remoteVersion = Number(remoteRow?.version) || 0;
  const merged = mergeConversationsPreservingParents(localConversation, remoteConversation);
  if (!merged || !remoteVersion) return false;

  const saved = await provider.saveCloudConversation(merged, remoteVersion);
  if (saved.conflict || !saved.row) return false;
  markConversationSynced(merged, saved.row.version);
  contentDb.conversations[merged.id] = merged;
  return true;
}

function replaceConversationFromCloud(remote) {
  const conversation = remote?.payload;
  if (!conversation || typeof conversation !== "object" || conversation.id !== remote.conversation_id) return false;
  contentDb.conversations[conversation.id] = conversation;
  markConversationSynced(conversation, remote.version);
  return true;
}

function openSettings() {
  openDialog(els.settingsDialog);
}

function openChatSettings() {
  openDialog(els.chatSettingsDialog);
}

function saveChatSettings(event) {
  event.preventDefault();
  saveActiveConversationSettings();
  closeDialog(els.chatSettingsDialog);
  setStatus(els, "chat settings saved");
}

function saveProfile(event) {
  event.preventDefault();
  const profile = activeProfile(userDb);
  profile.provider = "supabase-edge";
  profile.supabase ||= {};
  profile.openai ||= {};

  const anonKey = els.supabaseAnonKeyInput.value.trim();
  const jwt = els.supabaseJwtInput.value.trim();
  const previousUrl = profile.supabase.url || "";
  const previousAnonKey = profile.supabase.anon_key || "";
  profile.supabase.url = els.supabaseUrlInput.value.trim();
  if (anonKey) profile.supabase.anon_key = anonKey;
  if (profile.supabase.url !== previousUrl || profile.supabase.anon_key !== previousAnonKey) {
    session.supabase_refresh_token = "";
    session.supabase_expires_at = 0;
  }
  if (jwt) {
    profile.supabase.jwt = jwt;
    session.supabase_expires_at = 0;
  }
  profile.model_provider = normalizedModelProvider(els.modelProviderSelect.value);
  profile.appearance = {
    font_family: normalizedFontFamily(els.fontFamilySelect.value),
    font_size: normalizedFontSize(els.fontSizeInput.value),
  };
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
  closeDialog(els.settingsDialog);
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
    session.supabase_refresh_token = authSession.refresh_token || "";
    session.supabase_expires_at = authExpiresAt(authSession);
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

async function refreshSupabaseJwtIfNeeded(profile, { force = false } = {}) {
  profile.supabase ||= {};
  if (!profile.supabase.url || !profile.supabase.anon_key || !session.supabase_refresh_token) return false;

  const expiresAt = Number(session.supabase_expires_at) || 0;
  const shouldRefresh = force
    || !profile.supabase.jwt
    || (expiresAt && expiresAt < Math.floor(Date.now() / 1000) + 120);
  if (!shouldRefresh) return false;

  setStatus(els, "refreshing Supabase JWT");
  const authSession = await requestSupabaseRefreshSession({
    supabaseUrl: profile.supabase.url,
    anonKey: profile.supabase.anon_key,
    refreshToken: session.supabase_refresh_token,
  });
  if (!authSession.access_token) throw new Error("Supabase did not return a refreshed access token.");

  profile.supabase.jwt = authSession.access_token;
  session.supabase_refresh_token = authSession.refresh_token || session.supabase_refresh_token;
  session.supabase_expires_at = authExpiresAt(authSession);
  userDb.updated_at = new Date().toISOString();
  persist();
  return true;
}

async function requestSupabaseRefreshSession({ supabaseUrl, anonKey, refreshToken }) {
  const baseUrl = supabaseUrl.replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
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

function authExpiresAt(authSession) {
  if (Number(authSession.expires_at)) return Number(authSession.expires_at);
  const expiresIn = Number(authSession.expires_in) || 3600;
  return Math.floor(Date.now() / 1000) + expiresIn;
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

function normalizedFontFamily(value) {
  return ["system", "serif", "mono"].includes(value) ? value : "system";
}

function normalizedFontSize(value) {
  const size = Number(value);
  if (!Number.isFinite(size)) return 15;
  return Math.min(19, Math.max(13, Math.round(size)));
}

function openDialog(dialog) {
  if (!dialog) return;
  try {
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  } catch {
    dialog.setAttribute("open", "");
  }
  dialog.classList.add("dialog-visible");
}

function closeDialog(dialog) {
  if (!dialog) return;
  try {
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  } catch {
    dialog.removeAttribute("open");
  }
  dialog.classList.remove("dialog-visible");
}
