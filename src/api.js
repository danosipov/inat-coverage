const BASE = "https://api.inaturalist.org/v1";
const MIN_INTERVAL_MS = 1100;

const cache = new Map();

let queueTail = Promise.resolve();
let lastCallAt = 0;

function buildUrl(path, params) {
  const url = new URL(BASE + path);
  const entries = Object.entries(params || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .sort(([a], [b]) => a.localeCompare(b));
  for (const [k, v] of entries) url.searchParams.set(k, String(v));
  return url.toString();
}

function throttle() {
  const next = queueTail.then(async () => {
    const wait = Math.max(0, lastCallAt + MIN_INTERVAL_MS - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();
  });
  queueTail = next.catch(() => {});
  return next;
}

export async function iNat(path, params = {}) {
  const url = buildUrl(path, params);
  if (cache.has(url)) return cache.get(url);

  await throttle();
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`iNat ${path} ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  cache.set(url, json);
  return json;
}

export async function resolvePlace(q) {
  const { results } = await iNat("/places/autocomplete", { q, per_page: 5 });
  if (!results?.length) throw new Error(`No place found for "${q}"`);
  return results[0];
}

export async function resolveTaxon(q) {
  const { results } = await iNat("/taxa/autocomplete", { q, per_page: 5 });
  if (!results?.length) throw new Error(`No taxon found for "${q}"`);
  return results[0];
}

// Flat list of all taxon nodes observed in the given place/taxon scope,
// regardless of user. Used as the structural backbone of the tree.
export async function regionalTaxonomy({ place_id, taxon_id }) {
  const json = await iNat("/observations/taxonomy", { place_id, taxon_id });
  return json.results || [];
}

// Species the user has observed globally (optionally scoped by taxon) —
// returns Set<taxon_id>. Intentionally NOT scoped by place: a species
// counts as observed even if seen outside the queried region.
export async function userSpeciesIds({ user_id, taxon_id }) {
  const ids = new Set();
  let page = 1;
  const perPage = 500;
  for (;;) {
    const json = await iNat("/observations/species_counts", {
      user_id,
      taxon_id,
      hrank: "species",
      per_page: perPage,
      page,
    });
    for (const r of json.results || []) {
      if (r?.taxon?.id != null) ids.add(r.taxon.id);
    }
    const seen = page * perPage;
    if (!json.total_results || seen >= json.total_results) break;
    page += 1;
    if (page > 20) break; // safety cap (10000 species — iNat API hard limit)
  }
  return ids;
}
