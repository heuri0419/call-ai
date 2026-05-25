import { contentToText, currentPath, promptVersions } from "./chatDomain.js";

export function getElements() {
  return {
    providerLine: document.querySelector("#providerLine"),
    exportButton: document.querySelector("#exportButton"),
    resetButton: document.querySelector("#resetButton"),
    profileForm: document.querySelector("#profileForm"),
    supabaseUrlInput: document.querySelector("#supabaseUrlInput"),
    supabaseAnonKeyInput: document.querySelector("#supabaseAnonKeyInput"),
    modelInput: document.querySelector("#modelInput"),
    vectorStoreInput: document.querySelector("#vectorStoreInput"),
    systemPromptInput: document.querySelector("#systemPromptInput"),
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

export function renderApp(els, { profile, conversation, onEditPrompt, onSwitchPromptVersion }) {
  const supabase = profile.supabase || {};
  const openai = profile.openai || {};
  els.providerLine.textContent = [
    profile.provider || "supabase-edge",
    supabase.url ? "url set" : "no url",
    supabase.anon_key ? "anon key set" : "no anon key",
    openai.model || "no model",
  ].join(" / ");

  els.supabaseUrlInput.value = supabase.url || "";
  els.modelInput.value = openai.model || "";
  els.vectorStoreInput.value = openai.vector_store_id || "";
  els.systemPromptInput.value = profile.script?.system_prompt || "";
  els.conversationTitle.textContent = conversation?.title || "Empty content database";
  renderMessages(els, conversation, { onEditPrompt, onSwitchPromptVersion });
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
