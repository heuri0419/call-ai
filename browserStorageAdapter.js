import { STORAGE_KEYS } from "./constants.js";
import { seedContentDb, seedUserDb } from "./seeds.js";
import { structuredCopy } from "./utils.js";

export function createBrowserStorageAdapter() {
  return {
    load() {
      return {
        contentDb: loadJson(STORAGE_KEYS.content) || structuredCopy(seedContentDb),
        userDb: loadJson(STORAGE_KEYS.user) || structuredCopy(seedUserDb),
        session: loadSession(),
      };
    },

    save({ contentDb, userDb }) {
      localStorage.setItem(STORAGE_KEYS.content, JSON.stringify(contentDb));
      localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(withoutSessionSecrets(userDb)));
    },

    saveSession(session) {
      sessionStorage.setItem(STORAGE_KEYS.session, JSON.stringify(session || {}));
    },

    reset() {
      const state = {
        contentDb: structuredCopy(seedContentDb),
        userDb: structuredCopy(seedUserDb),
        session: {},
      };
      this.save(state);
      this.saveSession(state.session);
      return state;
    },
  };
}

function loadJson(key) {
  const value = localStorage.getItem(key);
  return value ? JSON.parse(value) : null;
}

function loadSession() {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEYS.session) || "{}");
  } catch {
    return {};
  }
}

function withoutSessionSecrets(userDb) {
  const copy = structuredCopy(userDb);
  for (const profile of Object.values(copy.profiles || {})) {
    if (profile.supabase) profile.supabase.jwt = "";
  }
  return copy;
}
