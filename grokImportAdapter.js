import { conversationSyncState, mergeConversationsPreservingParents } from "./chatDomain.js";

export function importGrokExport(data, existingConversations = {}) {
  if (!data || !Array.isArray(data.conversations)) {
    throw new Error("This is not a Grok backend export. Choose prod-grok-backend.json.");
  }

  const conversations = [];
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  let rejected = 0;

  for (const entry of data.conversations) {
    const conversation = convertGrokConversation(entry);
    if (!conversation) {
      rejected += 1;
      continue;
    }
    const existing = existingConversations[conversation.id];
    if (!existing) {
      conversations.push(conversation);
      added += 1;
      continue;
    }

    const merged = mergeImportedConversation(existing, conversation);
    if (!merged || !conversationChanged(existing, merged)) {
      unchanged += 1;
      continue;
    }
    conversations.push(merged);
    updated += 1;
  }

  return { conversations, added, updated, unchanged, rejected };
}

function convertGrokConversation(entry) {
  const source = entry?.conversation;
  const sourceId = cleanString(source?.id);
  if (!sourceId || !Array.isArray(entry?.responses)) return null;

  const id = `grok-${sourceId}`;
  const responses = entry.responses
    .map((item) => item?.response)
    .filter((response) => response && cleanString(response._id) && typeof response.message === "string")
    .sort((a, b) => timestamp(a.create_time) - timestamp(b.create_time) || cleanString(a._id).localeCompare(cleanString(b._id)));

  const responseIdToNodeId = new Map(responses.map((response) => [cleanString(response._id), `grok-response-${cleanString(response._id)}`]));
  const mapping = {};
  let previousNodeId = null;

  for (const response of responses) {
    const responseId = cleanString(response._id);
    const nodeId = responseIdToNodeId.get(responseId);
    const declaredParent = responseIdToNodeId.get(cleanString(response.parent_response_id)) || null;
    const parent = declaredParent || previousNodeId;
    mapping[nodeId] = {
      id: nodeId,
      parent,
      children: [],
      message: {
        id: `grok-message-${responseId}`,
        author: { role: senderRole(response.sender), name: null, metadata: {} },
        content: { content_type: "text", parts: [response.message] },
        create_time: timestamp(response.create_time),
        update_time: null,
        status: response.partial ? "in_progress" : "finished_successfully",
        end_turn: senderRole(response.sender) === "assistant",
        weight: 1,
        channel: null,
        recipient: null,
        metadata: {
          model_slug: cleanString(response.model),
          message_type: "next",
          imported_from: "grok_official_export",
        },
      },
      node_metadata: {
        created_by: "grok-import-adapter",
        source_response_id: responseId,
      },
    };
    previousNodeId = nodeId;
  }

  for (const node of Object.values(mapping)) {
    if (node.parent && mapping[node.parent]) mapping[node.parent].children.push(node.id);
  }

  const leafNodeId = responseIdToNodeId.get(cleanString(source.leaf_response_id)) || previousNodeId;
  const model = lastAssistantModel(mapping) || "grok-4";
  const createTime = timestamp(source.create_time) || firstNodeTime(mapping);
  const updateTime = timestamp(source.modify_time) || lastNodeTime(mapping) || createTime;

  return {
    id,
    conversation_id: id,
    title: cleanString(source.title) || "Imported Grok conversation",
    create_time: createTime,
    update_time: updateTime,
    current_node: leafNodeId || null,
    default_model_slug: model,
    settings: {
      model_provider: "grok",
      model,
      vector_store_names: [],
      system_prompt: "",
      system_prompt_preset_id: "",
      system_prompt_preset_name: cleanString(source.system_prompt_name),
    },
    mapping,
    metadata: {
      provider: "supabase-edge",
      model_provider: "grok",
      adapter_version: "grok-import-adapter.v1",
      cloud_sync: {
        version: 0,
        dirty: true,
        synced_at: null,
      },
    },
    source: {
      kind: "grok_official_export",
      original_conversation_id: sourceId,
    },
  };
}

function senderRole(sender) {
  return String(sender || "").toLowerCase() === "human" ? "user" : "assistant";
}

function timestamp(value) {
  let raw = value && typeof value === "object" && "$date" in value ? value.$date : value;
  if (raw && typeof raw === "object" && "$numberLong" in raw) raw = raw.$numberLong;
  if (typeof raw === "number") return raw > 1e12 ? raw / 1000 : raw;
  if (/^\d+$/.test(String(raw || ""))) {
    const numeric = Number(raw);
    return numeric > 1e12 ? numeric / 1000 : numeric;
  }
  const parsed = Date.parse(String(raw || ""));
  return Number.isFinite(parsed) ? parsed / 1000 : 0;
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function lastAssistantModel(mapping) {
  return Object.values(mapping)
    .filter((node) => node.message?.author?.role === "assistant" && node.message?.metadata?.model_slug)
    .sort((a, b) => (b.message.create_time || 0) - (a.message.create_time || 0))[0]?.message?.metadata?.model_slug || "";
}

function firstNodeTime(mapping) {
  const times = Object.values(mapping)
    .map((node) => Number(node.message?.create_time))
    .filter(Number.isFinite);
  return times.length ? Math.min(...times) : 0;
}

function lastNodeTime(mapping) {
  return Math.max(...Object.values(mapping).map((node) => Number(node.message?.create_time) || 0), 0);
}

function mergeImportedConversation(existing, incoming) {
  const merged = mergeConversationsPreservingParents(existing, incoming);
  if (!merged) return null;

  const existingSync = conversationSyncState(existing);
  merged.current_node = deepestLeafNodeId(merged.mapping) || merged.current_node;
  merged.title = incoming.title || existing.title;
  merged.metadata ||= {};
  merged.metadata.cloud_sync = {
    version: existingSync.version,
    dirty: true,
    synced_at: existingSync.synced_at,
  };
  return merged;
}

function deepestLeafNodeId(mapping) {
  return Object.values(mapping || {})
    .filter((node) => !(node.children || []).length)
    .sort((a, b) => nodeDepth(mapping, b.id) - nodeDepth(mapping, a.id)
      || nodeCreateTime(b) - nodeCreateTime(a)
      || String(a.id).localeCompare(String(b.id)))[0]?.id || null;
}

function nodeDepth(mapping, nodeId) {
  let depth = 0;
  let current = nodeId;
  const seen = new Set();
  while (current && mapping[current] && !seen.has(current)) {
    seen.add(current);
    depth += 1;
    current = mapping[current].parent || null;
  }
  return depth;
}

function nodeCreateTime(node) {
  return Number(node?.message?.create_time ?? node?.create_time) || 0;
}

function conversationChanged(existing, merged) {
  if (existing.title !== merged.title || existing.current_node !== merged.current_node) return true;
  const existingIds = Object.keys(existing.mapping || {});
  const mergedIds = Object.keys(merged.mapping || {});
  return existingIds.length !== mergedIds.length
    || mergedIds.some((id) => !existing.mapping?.[id] || existing.mapping[id].parent !== merged.mapping[id].parent);
}
