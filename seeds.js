export const seedContentDb = {
  schema: "mobile-cache-mvp.content-db.v1",
  updated_at: "2026-05-25T00:00:00.000Z",
  conversations: {},
  conversation_index: [],
};

export const seedUserDb = {
  schema: "mobile-cache-mvp.user-db.v2",
  updated_at: "2026-05-25T00:00:00.000Z",
  active_profile_id: "local-profile",
  profiles: {
    "local-profile": {
      id: "local-profile",
      display_name: "Local Phone User",
      provider: "supabase-edge",
      supabase: {
        url: "",
        anon_key: "",
      },
      openai: {
        model: "gpt-4.1-mini",
        vector_store_id: "",
      },
      script: {
        id: "mobile-context-reply",
        name: "Mobile context reply",
        system_prompt: "You are a careful assistant. Use the provided local context when it is relevant.",
        context_node_limit: 6,
      },
    },
  },
};
