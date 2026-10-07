// Account storage on Netlify Blobs (built into Netlify — no extra service or sign-up).
// Data is kept in the "accounts" store, visible in Netlify → Blobs.
let override = null;
export function _setTestStore(s) { override = s; }

// A fresh store on every call: Netlify hands each request a short-lived access
// token, so a store kept from an earlier request fails with "Token expired".
export async function store() {
  if (override) return override;
  const { getStore } = await import("@netlify/blobs");
  return getStore({ name: "accounts", consistency: "strong" });
}

export async function getJSON(key) {
  const s = await store();
  return (await s.get(key, { type: "json" })) || null;
}
export async function putJSON(key, value) {
  const s = await store();
  await s.setJSON(key, value);
}
export async function del(key) {
  const s = await store();
  await s.delete(key);
}
