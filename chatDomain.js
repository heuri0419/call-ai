export function firstConversationId(contentDb) {
  return contentDb.conversation_index?.[0]?.id || Object.keys(contentDb.conversations || {})[0];
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
  const conversation = {
    id,
    conversation_id: id,
    title: "Mobile test conversation",
    create_time: now,
    update_time: now,
    current_node: null,
    default_model_slug: profile.openai?.model || "gpt-4.1-mini",
    mapping: {},
    metadata: { provider: "supabase-edge", adapter_version: "mobile-cache-mvp" },
    source: { kind: "created_in_mobile_cache_mvp" },
  };
  contentDb.conversations[id] = conversation;
  touchContentDb(contentDb, conversation);
  return conversation;
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
  contentDb.updated_at = new Date().toISOString();
  const preview = contentToText(conversation.mapping[conversation.current_node]?.message?.content)
    .replace(/\s+/g, " ")
    .slice(0, 160);
  const record = {
    id: conversation.id,
    title: conversation.title,
    create_time: conversation.create_time,
    update_time: conversation.update_time,
    current_node: conversation.current_node,
    default_model_slug: conversation.default_model_slug,
    preview_text: preview,
    is_archived: conversation.is_archived ?? null,
    is_starred: conversation.is_starred ?? null,
    source_kind: conversation.source?.kind,
    has_unsupported_content: hasUnsupportedContent(conversation),
  };
  const index = contentDb.conversation_index || [];
  const existing = index.findIndex((item) => item.id === conversation.id);
  if (existing >= 0) index[existing] = record;
  else index.push(record);
  contentDb.conversation_index = index;
}

function hasUnsupportedContent(conversation) {
  return Object.values(conversation.mapping || {}).some((node) => {
    const type = node.message?.content?.content_type;
    return type && type !== "text";
  });
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
