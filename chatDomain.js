export function firstConversationId(contentDb) {
  return contentDb.conversation_index?.[0]?.id || Object.keys(contentDb.conversations || {})[0];
}

export function conversationIndex(contentDb) {
  const records = new Map();
  for (const record of contentDb.conversation_index || []) {
    if (record?.id) records.set(record.id, record);
  }
  for (const conversation of Object.values(contentDb.conversations || {})) {
    if (!conversation?.id) continue;
    records.set(conversation.id, conversationIndexRecord(conversation));
  }
  return [...records.values()].sort((a, b) => (b.update_time || 0) - (a.update_time || 0));
}

export function getActiveConversation(contentDb, activeConversationId) {
  return contentDb.conversations?.[activeConversationId] || null;
}

export function activeProfile(userDb) {
  return userDb.profiles[userDb.active_profile_id];
}

export function createEmptyConversation(contentDb, profile) {
  const now = Date.now() / 1000;
  const id = `conversation-${crypto.randomUUID()}`;
  const settings = defaultConversationSettings(profile);
  const conversation = {
    id,
    conversation_id: id,
    title: "New conversation",
    create_time: now,
    update_time: now,
    current_node: null,
    default_model_slug: settings.model,
    settings,
    mapping: {},
    metadata: {
      provider: "supabase-edge",
      model_provider: settings.model_provider,
      adapter_version: "mobile-cache-mvp",
      cloud_sync: {
        version: 0,
        dirty: true,
        synced_at: null,
      },
    },
    source: { kind: "created_in_mobile_cache_mvp" },
  };
  contentDb.conversations[id] = conversation;
  touchContentDb(contentDb, conversation);
  return conversation;
}

export function conversationSettings(conversation, profile) {
  const defaults = defaultConversationSettings(profile);
  const stored = conversation?.settings || {};

  return {
    model_provider: stored.model_provider || conversation?.metadata?.model_provider || defaults.model_provider,
    model: stored.model || conversation?.default_model_slug || defaults.model,
    vector_store_names: Array.isArray(stored.vector_store_names) ? stored.vector_store_names : defaults.vector_store_names,
    system_prompt: typeof stored.system_prompt === "string" ? stored.system_prompt : defaults.system_prompt,
    system_prompt_preset_id: stored.system_prompt_preset_id || "",
    system_prompt_preset_name: stored.system_prompt_preset_name || "",
  };
}

export function syncConversationSettings(conversation, settings) {
  conversation.settings = {
    model_provider: settings.model_provider || "openai",
    model: settings.model || "",
    vector_store_names: Array.isArray(settings.vector_store_names) ? settings.vector_store_names : [],
    system_prompt: settings.system_prompt || "",
    system_prompt_preset_id: settings.system_prompt_preset_id || "",
    system_prompt_preset_name: settings.system_prompt_preset_name || "",
  };
  conversation.default_model_slug = conversation.settings.model;
  conversation.metadata ||= {};
  conversation.metadata.provider = "supabase-edge";
  conversation.metadata.model_provider = conversation.settings.model_provider;
  conversation.metadata.system_prompt_name = conversation.settings.system_prompt_preset_name;
}

export function titleFromInput(text) {
  const title = text.replace(/\s+/g, " ").trim().slice(0, 48);
  return title || "New conversation";
}

export function appendNode(conversation, role, text, model) {
  const parentId = conversation.current_node || null;
  const nodeId = `${role}-${crypto.randomUUID()}`;
  const node = {
    id: nodeId,
    parent: parentId,
    children: [],
    message: createMessage(role, text, Date.now() / 1000, model),
    node_metadata: { created_by: "mobile-cache-mvp" },
  };
  conversation.mapping[nodeId] = node;
  if (parentId && conversation.mapping[parentId]) {
    conversation.mapping[parentId].children = unique([...(conversation.mapping[parentId].children || []), nodeId]);
  }
  return node;
}

export function createPromptVersion(conversation, originalNodeId, text) {
  const original = conversation.mapping[originalNodeId];
  if (!original || !text.trim()) return null;

  const nodeId = `user-${crypto.randomUUID()}`;
  const parentId = original.parent || null;
  conversation.mapping[nodeId] = {
    id: nodeId,
    parent: parentId,
    children: [],
    message: createMessage("user", text.trim(), Date.now() / 1000, null),
    node_metadata: { created_by: "prompt-editor", version_of: originalNodeId },
  };

  if (parentId && conversation.mapping[parentId]) {
    conversation.mapping[parentId].children = unique([...(conversation.mapping[parentId].children || []), nodeId]);
  }

  conversation.current_node = nodeId;
  return conversation.mapping[nodeId];
}

export function switchPromptVersion(conversation, nodeId) {
  if (!nodeId) return;
  conversation.current_node = latestDescendant(conversation, nodeId);
}

export function currentPath(conversation) {
  const path = [];
  const seen = new Set();
  let nodeId = conversation.current_node;
  while (nodeId && conversation.mapping[nodeId] && !seen.has(nodeId)) {
    seen.add(nodeId);
    path.push(conversation.mapping[nodeId]);
    nodeId = conversation.mapping[nodeId].parent;
  }
  return path.reverse();
}

export function promptVersions(conversation, node) {
  const parentId = node.parent;
  if (!parentId || !conversation.mapping[parentId]) return [node];
  return (conversation.mapping[parentId].children || [])
    .map((id) => conversation.mapping[id])
    .filter((item) => item?.message?.author?.role === "user");
}

export function buildContext(conversation, limit) {
  return currentPath(conversation)
    .filter((node) => node.message)
    .slice(-limit)
    .map((node) => `${node.message.author?.role || "unknown"}: ${contentToText(node.message.content)}`)
    .join("\n\n---\n\n");
}

export function contentToText(content) {
  if (!content) return "";
  if (content.content_type === "text" && Array.isArray(content.parts)) {
    return content.parts.filter((part) => typeof part === "string").join("\n");
  }
  if (content.content_type === "multimodal_text" && Array.isArray(content.parts)) {
    return content.parts
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        return `[unsupported:${part?.content_type || "part"}]`;
      })
      .join("\n");
  }
  return `[unsupported:${content.content_type || "content"}]`;
}

export function touchContentDb(contentDb, conversation) {
  conversation.update_time = Date.now() / 1000;
  conversation.metadata ||= {};
  conversation.metadata.cloud_sync ||= {};
  conversation.metadata.cloud_sync.dirty = true;
  contentDb.updated_at = new Date().toISOString();
  const record = conversationIndexRecord(conversation);
  const index = (contentDb.conversation_index || []).filter((item) => item.id !== conversation.id);
  contentDb.conversation_index = [record, ...index].sort((a, b) => (b.update_time || 0) - (a.update_time || 0));
}

export function markConversationSynced(conversation, version) {
  conversation.metadata ||= {};
  conversation.metadata.cloud_sync = {
    version: Number(version) || 0,
    dirty: false,
    synced_at: new Date().toISOString(),
  };
}

export function conversationSyncState(conversation) {
  const cloudSync = conversation?.metadata?.cloud_sync || {};
  return {
    version: Number(cloudSync.version) || 0,
    dirty: cloudSync.dirty !== false,
    synced_at: cloudSync.synced_at || null,
  };
}

export function mergeConversationsPreservingParents(localConversation, remoteConversation) {
  if (!localConversation?.id || localConversation.id !== remoteConversation?.id) return null;

  const localUpdate = Number(localConversation.update_time) || 0;
  const remoteUpdate = Number(remoteConversation.update_time) || 0;
  const newer = localUpdate >= remoteUpdate ? localConversation : remoteConversation;
  const older = newer === localConversation ? remoteConversation : localConversation;
  const nodes = new Map();
  const createTimes = [localConversation.create_time, remoteConversation.create_time]
    .map((value) => Number(value))
    .filter(Number.isFinite);

  for (const node of Object.values(older.mapping || {})) {
    if (node?.id) nodes.set(node.id, node);
  }
  for (const node of Object.values(newer.mapping || {})) {
    if (node?.id) nodes.set(node.id, node);
  }

  const orderedNodes = [...nodes.values()]
    .map((node) => ({ ...node, children: [] }))
    .sort((a, b) => nodeCreateTime(a) - nodeCreateTime(b) || String(a.id).localeCompare(String(b.id)));

  const mapping = Object.fromEntries(orderedNodes.map((node) => [node.id, node]));
  let fallbackTail = null;
  for (const node of orderedNodes) {
    const parentId = node.parent || null;
    if (parentId && (!mapping[parentId] || parentId === node.id || createsParentCycle(mapping, node.id, parentId))) {
      node.parent = fallbackTail && !createsParentCycle(mapping, node.id, fallbackTail) ? fallbackTail : null;
    }
    fallbackTail = node.id;
  }

  for (const node of orderedNodes) {
    if (node.parent && mapping[node.parent]) mapping[node.parent].children.push(node.id);
  }
  for (const node of orderedNodes) {
    node.children.sort((a, b) => nodeCreateTime(mapping[a]) - nodeCreateTime(mapping[b]) || a.localeCompare(b));
  }

  const currentNode = mapping[newer.current_node]
    ? newer.current_node
    : mapping[older.current_node]
      ? older.current_node
      : orderedNodes.at(-1)?.id || null;

  return {
    ...older,
    ...newer,
    id: localConversation.id,
    conversation_id: localConversation.id,
    create_time: createTimes.length ? Math.min(...createTimes) : 0,
    update_time: Math.max(localUpdate, remoteUpdate),
    current_node: currentNode,
    mapping,
    metadata: {
      ...(older.metadata || {}),
      ...(newer.metadata || {}),
    },
  };
}

function conversationIndexRecord(conversation) {
  const preview = contentToText(conversation.mapping[conversation.current_node]?.message?.content)
    .replace(/\s+/g, " ")
    .slice(0, 160);
  return {
    id: conversation.id,
    title: conversation.title || "New conversation",
    create_time: conversation.create_time,
    update_time: conversation.update_time,
    current_node: conversation.current_node,
    default_model_slug: conversation.default_model_slug,
    model_provider: conversation.metadata?.model_provider || "",
    system_prompt_name: conversation.settings?.system_prompt_preset_name || "",
    vector_store_names: conversation.settings?.vector_store_names || [],
    message_count: Object.values(conversation.mapping || {}).filter((node) => node.message).length,
    preview_text: preview,
    is_archived: conversation.is_archived ?? null,
    is_starred: conversation.is_starred ?? null,
    source_kind: conversation.source?.kind,
    has_unsupported_content: hasUnsupportedContent(conversation),
    cloud_version: conversationSyncState(conversation).version,
    cloud_dirty: conversationSyncState(conversation).dirty,
  };
}

function defaultConversationSettings(profile) {
  const openai = profile.openai || {};
  const activeAlias = openai.active_vector_store_alias || "";
  return {
    model_provider: profile.model_provider || "openai",
    model: openai.model || "gpt-4.1-mini",
    vector_store_names: activeAlias ? [activeAlias] : [],
    system_prompt: profile.script?.system_prompt || "",
    system_prompt_preset_id: "",
    system_prompt_preset_name: profile.script?.name || "",
  };
}

function hasUnsupportedContent(conversation) {
  return Object.values(conversation.mapping || {}).some((node) => {
    const type = node.message?.content?.content_type;
    return type && type !== "text";
  });
}

function nodeCreateTime(node) {
  return Number(node?.message?.create_time ?? node?.create_time) || 0;
}

function createsParentCycle(mapping, nodeId, parentId) {
  const seen = new Set([nodeId]);
  let current = parentId;
  while (current && mapping[current]) {
    if (seen.has(current)) return true;
    seen.add(current);
    current = mapping[current].parent || null;
  }
  return false;
}

function createMessage(role, text, time, model) {
  return {
    id: `message-${crypto.randomUUID()}`,
    author: { role, name: null, metadata: {} },
    content: { content_type: "text", parts: [text] },
    create_time: time,
    update_time: null,
    status: "finished_successfully",
    end_turn: role === "assistant",
    weight: 1,
    channel: null,
    recipient: null,
    metadata: model ? { model_slug: model, message_type: "next" } : { message_type: "next" },
  };
}

function latestDescendant(conversation, nodeId) {
  let current = nodeId;
  const seen = new Set();
  while (current && conversation.mapping[current] && !seen.has(current)) {
    seen.add(current);
    const children = conversation.mapping[current].children || [];
    if (!children.length) break;
    current = children[children.length - 1];
  }
  return current;
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}
