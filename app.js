import { createBrowserStorageAdapter } from "./browserStorageAdapter.js";
import { callRunScriptFunction } from "./edgeFunctionClient.js";
import { exportDatabases } from "./exportAdapter.js";
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
import { getElements, openPromptEditor, renderApp, setStatus } from "./ui.js";

const storage = createBrowserStorageAdapter();
const els = getElements();

let { contentDb, userDb } = storage.load();
let activeConversationId = firstConversationId(contentDb);
let editingNodeId = null;

els.profileForm.addEventListener("submit", saveProfile);
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
    const output = await callRunScriptFunction({
      supabaseUrl: supabase.url,
      anonKey: supabase.anon_key,
      model: openai.model,
      vectorStoreId: openai.vector_store_id || "",
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
  profile.supabase.url = els.supabaseUrlInput.value.trim();
  if (anonKey) profile.supabase.anon_key = anonKey;
  profile.openai.model = els.modelInput.value.trim();
  profile.openai.vector_store_id = els.vectorStoreInput.value.trim();
  profile.script ||= {};
  profile.script.system_prompt = els.systemPromptInput.value.trim();
  userDb.updated_at = new Date().toISOString();
  persist();
  els.supabaseAnonKeyInput.value = "";
  els.profileStatus.textContent = "saved in browser storage";
  render();
}

function resetLocalDatabases() {
  if (!window.confirm("Reload empty data and clear this page's browser-local MVP data?")) return;
  ({ contentDb, userDb } = storage.reset());
  activeConversationId = firstConversationId(contentDb);
  render();
  setStatus(els, "empty database reloaded");
}
