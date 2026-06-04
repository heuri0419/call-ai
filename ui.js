import { contentToText, conversationSettings, currentPath, promptVersions } from "./chatDomain.js";

export function getElements() {
  return {
    appShell: document.querySelector("#appShell"),
    sidebarToggleButton: document.querySelector("#sidebarToggleButton"),
    sidebarRefreshButton: document.querySelector("#sidebarRefreshButton"),
    newConversationButton: document.querySelector("#newConversationButton"),
    conversationList: document.querySelector("#conversationList"),
    providerLine: document.querySelector("#providerLine"),
    exportButton: document.querySelector("#exportButton"),
    resetButton: document.querySelector("#resetButton"),
    profileForm: document.querySelector("#profileForm"),
    supabaseUrlInput: document.querySelector("#supabaseUrlInput"),
    supabaseAnonKeyInput: document.querySelector("#supabaseAnonKeyInput"),
    supabaseJwtInput: document.querySelector("#supabaseJwtInput"),
    supabaseEmailInput: document.querySelector("#supabaseEmailInput"),
    supabasePasswordInput: document.querySelector("#supabasePasswordInput"),
    supabaseLoginButton: document.querySelector("#supabaseLoginButton"),
    modelProviderSelect: document.querySelector("#modelProviderSelect"),
    modelInput: document.querySelector("#modelInput"),
    modelList: document.querySelector("#modelList"),
    modelSelect: document.querySelector("#modelSelect"),
    modelFilterSelect: document.querySelector("#modelFilterSelect"),
    loadModelsButton: document.querySelector("#loadModelsButton"),
    vectorStoreAliasesInput: document.querySelector("#vectorStoreAliasesInput"),
    activeVectorStoreSelect: document.querySelector("#activeVectorStoreSelect"),
    systemPromptInput: document.querySelector("#systemPromptInput"),
    systemPromptPresetSelect: document.querySelector("#systemPromptPresetSelect"),
    systemPromptPresetNameInput: document.querySelector("#systemPromptPresetNameInput"),
    loadPresetsButton: document.querySelector("#loadPresetsButton"),
    savePresetButton: document.querySelector("#savePresetButton"),
    profileStatus: document.querySelector("#profileStatus"),
    conversationTitle: document.querySelector("#conversationTitle"),
    statusLine: document.querySelector("#statusLine"),
    messageStack: document.querySelector("#messageStack"),
    runForm: document.querySelector("#runForm"),
    inputBox: document.querySelector("#inputBox"),
    runButton: document.querySelector("#runButton"),
    editDialog: document.querySelector("#editDialog"),
    editPromptInput: document.querySelector("#editPromptInput"),
    saveEditButton: document.querySelector("#saveEditButton"),
  };
}

export function renderApp(
  els,
  {
    profile,
    conversation,
    conversations,
    activeConversationId,
    isSidebarOpen,
    presets,
    onSelectConversation,
    onNewConversation,
    onEditPrompt,
    onSwitchPromptVersion,
  },
) {
  const supabase = profile.supabase || {};
  const openai = profile.openai || {};
  const settings = conversationSettings(conversation, profile);
  const modelProvider = settings.model_provider;
  els.appShell.classList.toggle("sidebar-closed", !isSidebarOpen);
  els.sidebarToggleButton.textContent = isSidebarOpen ? "Hide chats" : "Chats";
  els.sidebarToggleButton.setAttribute("aria-expanded", String(isSidebarOpen));
  els.providerLine.textContent = [
    profile.provider || "supabase-edge",
    modelProvider,
    supabase.url ? "url set" : "no url",
    supabase.anon_key ? "anon key set" : "no anon key",
    supabase.jwt ? "jwt set" : "no jwt",
    settings.model || "no model",
    settings.vector_store_names[0] || "no vector",
  ].join(" / ");

  els.supabaseUrlInput.value = supabase.url || "";
  els.modelProviderSelect.value = modelProvider;
  els.modelInput.value = settings.model || "";
  renderVectorStoreSelect(els, openai, settings.vector_store_names[0] || "");
  setVectorStoreDisabled(els, modelProvider !== "openai");
  els.systemPromptInput.value = settings.system_prompt || "";
  els.systemPromptPresetNameInput.value = settings.system_prompt_preset_name || "";
  renderPresetChoices(els, presets, settings.system_prompt_preset_id);
  els.conversationTitle.textContent = conversation?.title || "Empty content database";
  renderConversationList(els, conversations, activeConversationId, { onSelectConversation, onNewConversation });
  renderMessages(els, conversation, { onEditPrompt, onSwitchPromptVersion });
}

function renderConversationList(els, conversations, activeConversationId, handlers) {
  els.conversationList.replaceChildren();
  if (!conversations.length) {
    const empty = document.createElement("li");
    empty.className = "conversation-empty";
    empty.textContent = "No cached conversations";
    els.conversationList.append(empty);
    return;
  }

  for (const conversation of conversations) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.className = "conversation-button";
    button.type = "button";
    button.setAttribute("aria-current", conversation.id === activeConversationId ? "true" : "false");
    button.addEventListener("click", () => handlers.onSelectConversation(conversation.id));

    const title = document.createElement("span");
    title.className = "conversation-title";
    title.textContent = conversation.title || "New conversation";

    const meta = document.createElement("span");
    meta.className = "conversation-meta";
    meta.textContent = [
      conversation.model_provider || "provider?",
      conversation.default_model_slug || "model?",
      conversation.system_prompt_name || "custom sys",
      `${conversation.message_count || 0} msg`,
    ].join(" / ");

    const preview = document.createElement("span");
    preview.className = "conversation-preview";
    preview.textContent = conversation.preview_text || "Cached locally";

    button.append(title, meta, preview);
    item.append(button);
    els.conversationList.append(item);
  }
}

function setVectorStoreDisabled(els, disabled) {
  els.vectorStoreAliasesInput.disabled = disabled;
  els.activeVectorStoreSelect.disabled = disabled;
}

export function renderModelChoices(els, models, filter = "text") {
  const visibleModels = filterModels(models, filter);
  const modelIds = visibleModels.map((model) => model.id).filter(Boolean);
  els.modelList.replaceChildren(...modelIds.map((id) => new Option(id, id)));
  els.modelSelect.replaceChildren(new Option("Select a loaded model", ""));
  for (const model of visibleModels) {
    const ownedBy = model.owned_by ? ` / ${model.owned_by}` : "";
    const label = `${model.id} [${model.category || "model"}${ownedBy}]`;
    els.modelSelect.append(new Option(label, model.id));
  }
  els.modelSelect.value = modelIds.includes(els.modelInput.value) ? els.modelInput.value : "";
}

export function renderPresetChoices(els, presets, selectedId = "") {
  els.systemPromptPresetSelect.replaceChildren(new Option("No preset selected", ""));
  for (const preset of presets || []) {
    const provider = preset.provider && preset.provider !== "all" ? ` / ${preset.provider}` : "";
    const label = `${preset.name}${provider}${preset.is_default ? " / default" : ""}`;
    els.systemPromptPresetSelect.append(new Option(label, preset.id));
  }
  els.systemPromptPresetSelect.value = (presets || []).some((preset) => preset.id === selectedId) ? selectedId : "";
}

function filterModels(models, filter) {
  if (filter === "fine-tuned") return models.filter((model) => model.is_fine_tuned);
  if (filter === "all") return models;
  return models.filter((model) => model.is_text_candidate);
}

export function vectorStoreAliases(openai) {
  if (Array.isArray(openai.vector_store_aliases)) return openai.vector_store_aliases;
  if (Array.isArray(openai.vector_store_names)) return openai.vector_store_names;
  if (typeof openai.vector_store_name === "string" && openai.vector_store_name.trim()) {
    return [openai.vector_store_name.trim()];
  }
  return [];
}

export function activeVectorStoreAlias(openai) {
  if (typeof openai.active_vector_store_alias === "string") return openai.active_vector_store_alias.trim();
  if (typeof openai.active_vector_store_name === "string") return openai.active_vector_store_name.trim();
  const aliases = vectorStoreAliases(openai);
  return aliases.length === 1 ? aliases[0] : "";
}

function renderVectorStoreSelect(els, openai, activeOverride = "") {
  const aliases = vectorStoreAliases(openai);
  const active = activeOverride || activeVectorStoreAlias(openai);
  els.vectorStoreAliasesInput.value = aliases.join(", ");
  els.activeVectorStoreSelect.replaceChildren(new Option("None", ""));
  for (const alias of aliases) {
    els.activeVectorStoreSelect.append(new Option(alias, alias));
  }
  els.activeVectorStoreSelect.value = aliases.includes(active) ? active : "";
}

export function renderMessages(els, conversation, handlers) {
  els.messageStack.replaceChildren();
  if (!conversation) {
    const empty = document.createElement("article");
    empty.className = "message";
    empty.innerHTML =
      '<div class="message-meta">empty</div><div class="message-text">The content database is empty. Run a prompt to create the first conversation.</div>';
    els.messageStack.append(empty);
    return;
  }
  for (const node of currentPath(conversation).filter((item) => item.message)) {
    els.messageStack.append(renderMessage(conversation, node, handlers));
  }
}

export function setStatus(els, message) {
  els.statusLine.textContent = message;
}

export function openPromptEditor(els, text) {
  els.editPromptInput.value = text;
  els.editDialog.showModal();
}

function renderMessage(conversation, node, handlers) {
  const role = node.message.author?.role || "unknown";
  const article = document.createElement("article");
  article.className = `message ${role}`;

  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.textContent = role;

  const text = document.createElement("div");
  text.className = "message-text";
  text.textContent = contentToText(node.message.content);

  article.append(meta, text);
  if (role === "user") article.append(renderPromptToolbar(conversation, node, handlers));
  return article;
}

function renderPromptToolbar(conversation, node, handlers) {
  const toolbar = document.createElement("div");
  toolbar.className = "prompt-toolbar";

  const copyButton = iconButton("copy", "Copy prompt");
  copyButton.addEventListener("click", () => navigator.clipboard?.writeText(contentToText(node.message.content)));

  const editButton = iconButton("edit", "Edit prompt");
  editButton.addEventListener("click", () => handlers.onEditPrompt(node.id));

  const versions = promptVersions(conversation, node);
  const index = versions.findIndex((item) => item.id === node.id);
  const previousButton = iconButton("<", "Previous version");
  const nextButton = iconButton(">", "Next version");
  const versionLabel = document.createElement("span");
  versionLabel.className = "version-label";
  versionLabel.textContent = `${index + 1}/${versions.length}`;

  previousButton.disabled = index <= 0;
  nextButton.disabled = index >= versions.length - 1;
  previousButton.addEventListener("click", () => handlers.onSwitchPromptVersion(versions[index - 1]?.id));
  nextButton.addEventListener("click", () => handlers.onSwitchPromptVersion(versions[index + 1]?.id));

  toolbar.append(copyButton, editButton, previousButton, versionLabel, nextButton);
  return toolbar;
}

function iconButton(label, title) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "prompt-icon";
  button.textContent = label;
  button.title = title;
  return button;
}
