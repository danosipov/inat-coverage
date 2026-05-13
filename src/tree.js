// Build a nested tree from the flat /observations/taxonomy response.
//
// Each input node looks roughly like:
//   { id, parent_id, name, rank, rank_level, preferred_common_name, ... }
// We index by id, attach children to their parent when the parent is also in
// the set, otherwise treat the node as a tree root.
//
// If `rootId` is provided, only descendants of that id are returned; if the
// root itself isn't in the flat list, we synthesize a placeholder.

export function buildTree(flatNodes, rootId) {
  const byId = new Map();
  for (const raw of flatNodes) {
    const n = normalize(raw);
    byId.set(n.id, n);
  }

  const roots = [];
  for (const n of byId.values()) {
    const parent = n.parent_id != null ? byId.get(n.parent_id) : null;
    if (parent) parent.children.push(n);
    else roots.push(n);
  }

  for (const n of byId.values()) sortChildren(n);

  if (rootId != null) {
    const r = byId.get(rootId);
    if (r) return [r];
    // Root not observed: surface its observed children as top-level.
    return roots.filter((n) => n.ancestor_ids?.includes(rootId));
  }

  return roots;
}

function normalize(raw) {
  // /observations/taxonomy nests the taxon fields at the top level.
  return {
    id: raw.id,
    parent_id: raw.parent_id ?? null,
    name: raw.name,
    rank: raw.rank,
    rank_level: raw.rank_level,
    preferred_common_name: raw.preferred_common_name || "",
    ancestor_ids: raw.ancestor_ids || [],
    direct_obs_count: raw.direct_obs_count ?? 0,
    descendant_obs_count: raw.descendant_obs_count ?? 0,
    children: [],
    coverage: undefined, // { N, Y, pct } precomputed
    suggestion: undefined, // 'rendered' once the species list has been drawn
  };
}

function sortChildren(node) {
  node.children.sort((a, b) => {
    // Higher rank_level first (kingdom before species), then by name.
    if (a.rank_level !== b.rank_level) return b.rank_level - a.rank_level;
    return (a.name || "").localeCompare(b.name || "");
  });
}

export function walk(nodes, fn) {
  for (const n of nodes) {
    fn(n);
    if (n.children.length) walk(n.children, fn);
  }
}
