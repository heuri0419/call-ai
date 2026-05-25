import { structuredCopy } from "./utils.js";

export function exportDatabases({ contentDb, userDb }) {
  const payload = { exported_at: new Date().toISOString(), contentDb, userDb: maskUserDb(userDb) };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `mobile-cache-mvp-export-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function maskUserDb(value) {
  const copy = structuredCopy(value);
  for (const profile of Object.values(copy.profiles || {})) {
    if (profile.supabase?.anon_key) profile.supabase.anon_key = "[redacted]";
  }
  return copy;
}
