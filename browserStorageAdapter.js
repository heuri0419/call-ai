import { STORAGE_KEYS } from "./constants.js";
import { seedContentDb, seedUserDb } from "./seeds.js";
import { structuredCopy } from "./utils.js";

export function createBrowserStorageAdapter() {
  return {
    load() {
      return {
        contentDb: loadJson(STORAGE_KEYS.content) || structuredCopy(seedContentDb),
        userDb: loadJson(STORAGE_KEYS.user) || structuredCopy(seedUserDb),
      };
    },

    save({ contentDb, userDb }) {
      localStorage.setItem(STORAGE_KEYS.content, JSON.stringify(contentDb));
      localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(userDb));
    },

    reset() {
      const state = {
        contentDb: structuredCopy(seedContentDb),
        userDb: structuredCopy(seedUserDb),
      };
      this.save(state);
      return state;
    },
  };
}

function loadJson(key) {
  const value = localStorage.getItem(key);
  return value ? JSON.parse(value) : null;
}
