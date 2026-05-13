import {
  resolvePlace,
  resolveTaxon,
  regionalTaxonomy,
  userSpeciesIds,
} from "./api.js";
import { attachAutocomplete } from "./autocomplete.js";
import { buildTree, walk } from "./tree.js";

const form = document.getElementById("query");
const statusEl = document.getElementById("status");
const resolvedEl = document.getElementById("resolved");
const heroEl = document.getElementById("hero");
const treeEl = document.getElementById("tree");

const placeAC = attachAutocomplete(form.place, {
  endpoint: "/places/autocomplete",
  renderItem: (r, li) => {
    const name = document.createElement("span");
    name.className = "ac-name";
    name.textContent = r.display_name || r.name;
    li.appendChild(name);
    const hint = r.place_type_name || r.admin_level;
    if (hint != null && hint !== "") {
      const h = document.createElement("span");
      h.className = "ac-hint";
      h.textContent = String(hint);
      li.appendChild(h);
    }
  },
});

const taxonAC = attachAutocomplete(form.taxon, {
  endpoint: "/taxa/autocomplete",
  renderItem: (r, li) => {
    const name = document.createElement("span");
    name.className = "ac-name";
    name.textContent = r.name;
    li.appendChild(name);
    if (r.preferred_common_name) {
      const common = document.createElement("span");
      common.className = "common";
      common.textContent = `· ${r.preferred_common_name}`;
      li.appendChild(common);
    }
    if (r.rank) {
      const h = document.createElement("span");
      h.className = "ac-hint";
      h.textContent = r.rank;
      li.appendChild(h);
    }
  },
});

let ctx = null; // { user, place, taxon?, userObservedSpeciesIds: Set<number> }

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const user = form.user.value.trim();
  const placeQuery = form.place.value.trim();
  const taxonQuery = form.taxon.value.trim();
  if (!user || !placeQuery) return;

  resetUI();
  setStatus(`Resolving place "${placeQuery}"…`);
  const submit = form.querySelector("button");
  submit.disabled = true;

  try {
    const place = await resolveFromSelection(placeAC, placeQuery, resolvePlace);
    const taxon = taxonQuery
      ? await resolveFromSelection(taxonAC, taxonQuery, resolveTaxon)
      : null;
    showResolved(user, place, taxon);

    setStatus(`Fetching regional taxonomy + ${user}'s observed species…`);
    const [flat, observedIds] = await Promise.all([
      regionalTaxonomy({
        place_id: place.id,
        taxon_id: taxon?.id,
      }),
      userSpeciesIds({
        user_id: user,
        taxon_id: taxon?.id,
      }),
    ]);

    ctx = {
      user,
      place,
      taxon,
      userObservedSpeciesIds: observedIds,
    };

    if (!flat.length) {
      setStatus("No regional taxonomy data for this scope.");
      return;
    }

    const roots = buildTree(flat, taxon?.id);
    if (!roots.length) {
      setStatus("No taxonomy nodes to display.");
      return;
    }

    computeCoverage(roots, observedIds);
    renderHero(user, place, taxon, roots);
    renderTree(roots, treeEl);
    syncUrl({ user, place, taxon });

    let speciesTotal = 0;
    walk(roots, (n) => {
      if (n.rank === "species") speciesTotal += 1;
    });
    const totalSeen = [...observedIds].length;
    setStatus(
      `Loaded ${flat.length} taxa · ${speciesTotal} species in region · ${totalSeen} observed by ${user}.`,
    );
  } catch (err) {
    console.error(err);
    setStatus(err.message || String(err), true);
  } finally {
    submit.disabled = false;
  }
});

function syncUrl({ user, place, taxon }) {
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("user", user);
  url.searchParams.set("place_id", String(place.id));
  url.searchParams.set("place", place.display_name || place.name);
  if (taxon) {
    url.searchParams.set("taxon_id", String(taxon.id));
    url.searchParams.set("taxon", taxon.name);
  }
  history.replaceState(null, "", url);
}

function loadFromUrl() {
  const params = new URLSearchParams(location.search);
  const user = params.get("user");
  const placeName = params.get("place");
  const placeId = params.get("place_id");
  if (!user || !placeName) return;

  form.user.value = user;
  if (placeName) form.place.value = placeName;
  if (placeId) {
    placeAC.setSelected({
      id: Number(placeId),
      display_name: placeName || "",
      name: placeName || "",
    });
  }
  const taxonName = params.get("taxon");
  const taxonId = params.get("taxon_id");
  if (taxonName) form.taxon.value = taxonName;
  if (taxonId) {
    taxonAC.setSelected({
      id: Number(taxonId),
      name: taxonName || "",
    });
  }
  form.requestSubmit();
}

loadFromUrl();

async function resolveFromSelection(ac, query, resolver) {
  const picked = ac.getSelected();
  if (picked && (picked.display_name || picked.name) === query) return picked;
  return resolver(query);
}

function resetUI() {
  treeEl.innerHTML = "";
  resolvedEl.innerHTML = "";
  heroEl.innerHTML = "";
  heroEl.hidden = true;
  setStatus("");
}

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", !!isError);
}

function showResolved(user, place, taxon) {
  const parts = [
    `user <code>${escapeHtml(user)}</code>`,
    `place <code>${escapeHtml(place.display_name || place.name)}</code> (id ${place.id})`,
  ];
  if (taxon) {
    parts.push(
      `taxon <code>${escapeHtml(taxon.name)}</code> (${taxon.rank || "?"}, id ${taxon.id})`,
    );
  }
  resolvedEl.innerHTML = parts.join(" · ");
}

function renderHero(user, place, taxon, roots) {
  let N = 0;
  let Y = 0;
  for (const r of roots) {
    if (r.coverage && r.coverage !== "error") {
      N += r.coverage.N;
      Y += r.coverage.Y;
    }
  }
  if (N === 0) {
    heroEl.hidden = true;
    return;
  }
  const pct = (Y / N) * 100;
  const taxonLabel = taxonDisplayName(taxon);
  const placeLabel = place.display_name || place.name;

  heroEl.hidden = false;
  heroEl.innerHTML = "";

  const headline = document.createElement("p");
  headline.className = "hero-headline";
  headline.innerHTML =
    `<strong>${escapeHtml(user)}</strong> has observed ` +
    `<strong>${pct.toFixed(1)}%</strong> of ${escapeHtml(taxonLabel)} ` +
    `in ${escapeHtml(placeLabel)}!`;
  heroEl.appendChild(headline);

  const stat = document.createElement("div");
  stat.className = "hero-stat";
  const big = document.createElement("span");
  big.className = "hero-pct";
  big.textContent = `${pct.toFixed(1)}%`;
  stat.appendChild(big);
  const fraction = document.createElement("span");
  fraction.className = "hero-fraction";
  fraction.textContent = `${Y.toLocaleString()} of ${N.toLocaleString()} species`;
  stat.appendChild(fraction);
  heroEl.appendChild(stat);

  const bar = document.createElement("div");
  bar.className = "hero-bar";
  const fill = document.createElement("div");
  fill.className = "hero-bar-fill";
  fill.style.width = `${Math.min(100, pct).toFixed(2)}%`;
  bar.appendChild(fill);
  heroEl.appendChild(bar);

  heroEl.appendChild(renderShareButtons({ user, place, taxon, pct, Y, N }));
}

function taxonDisplayName(taxon) {
  if (!taxon) return "all species";
  if (taxon.preferred_common_name) return taxon.preferred_common_name;
  return taxon.name;
}

function buildShareUrl({ user, place, taxon }) {
  const params = new URLSearchParams();
  params.set("user", user);
  params.set("place_id", String(place.id));
  params.set("place", place.display_name || place.name);
  if (taxon) {
    params.set("taxon_id", String(taxon.id));
    params.set("taxon", taxon.name);
  }
  const url = new URL(location.href);
  url.search = params.toString();
  url.hash = "";
  return url.toString();
}

function buildShareText({ user, place, taxon, pct, Y, N }) {
  const taxonLabel = taxonDisplayName(taxon);
  const placeLabel = place.display_name || place.name;
  return (
    `${user} has observed ${pct.toFixed(1)}% ` +
    `(${Y.toLocaleString()}/${N.toLocaleString()}) of ${taxonLabel} ` +
    `in ${placeLabel} on iNaturalist.`
  );
}

function renderShareButtons(data) {
  const wrap = document.createElement("div");
  wrap.className = "hero-share";

  const label = document.createElement("span");
  label.className = "hero-share-label";
  label.textContent = "Share:";
  wrap.appendChild(label);

  const url = buildShareUrl(data);
  const text = buildShareText(data);

  const bskyUrl =
    "https://bsky.app/intent/compose?" +
    new URLSearchParams({ text: `${text} ${url}` }).toString();
  wrap.appendChild(shareAnchor("bsky", "Bluesky", bskyUrl));

  const fbUrl =
    "https://www.facebook.com/sharer/sharer.php?" +
    new URLSearchParams({ u: url, quote: text }).toString();
  wrap.appendChild(shareAnchor("fb", "Facebook", fbUrl));

  const wa =
    "https://api.whatsapp.com/send?" +
    new URLSearchParams({ text: `${text} ${url}` }).toString();
  wrap.appendChild(shareAnchor("wa", "WhatsApp", wa));

  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "share-btn copy";
  copy.textContent = "Copy link";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(url);
      copy.textContent = "Copied!";
      copy.classList.add("copied");
      setTimeout(() => {
        copy.textContent = "Copy link";
        copy.classList.remove("copied");
      }, 1600);
    } catch {
      copy.textContent = "Copy failed";
    }
  });
  wrap.appendChild(copy);

  if (navigator.share) {
    const native = document.createElement("button");
    native.type = "button";
    native.className = "share-btn native";
    native.textContent = "Share…";
    native.addEventListener("click", () => {
      navigator.share({ title: "iNat Coverage", text, url }).catch(() => {});
    });
    wrap.appendChild(native);
  }

  return wrap;
}

function shareAnchor(variant, label, href) {
  const a = document.createElement("a");
  a.className = `share-btn share-${variant}`;
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = label;
  return a;
}

function renderTree(nodes, parentEl) {
  const ul = document.createElement("ul");
  for (const node of nodes) {
    const li = renderNode(node);
    const details = li.querySelector("details");
    if (details) details.open = true;
    ul.appendChild(li);
  }
  parentEl.appendChild(ul);
}

// Collapse single-child chains: walk down while each node has exactly one
// child. Stop before entering a species — species get rendered inside the
// parent's "try next" list, not as their own tree nodes.
function collapseChain(node) {
  const chain = [node];
  let cur = node;
  while (
    cur.children.length === 1 &&
    cur.children[0].rank !== "species" &&
    cur.rank !== "species"
  ) {
    cur = cur.children[0];
    chain.push(cur);
  }
  return chain;
}

function renderNode(node) {
  const chain = collapseChain(node);
  const tail = chain[chain.length - 1];

  const li = document.createElement("li");
  const details = document.createElement("details");
  details.className = "node";
  if (chain.length > 1) details.classList.add("collapsed-chain");

  const summary = document.createElement("summary");
  summary.appendChild(renderBreadcrumb(chain));
  const coverage = renderCoverage(tail.coverage);
  summary.appendChild(coverage);
  details.appendChild(summary);

  const body = document.createElement("div");
  body.className = "node-body";
  details.appendChild(body);

  tail._dom = { details, summary, coverage, body };

  details.addEventListener("toggle", () => {
    if (!details.open) return;
    if (!body.dataset.rendered) {
      body.dataset.rendered = "1";
      const nonSpeciesChildren = tail.children.filter((c) => c.rank !== "species");
      if (nonSpeciesChildren.length) {
        const ul = document.createElement("ul");
        for (const c of nonSpeciesChildren) ul.appendChild(renderNode(c));
        body.appendChild(ul);
      }
    }
    if (tail.suggestion === undefined && shouldSuggestAt(tail)) renderSpeciesList(tail);
  });

  li.appendChild(details);
  return li;
}

function renderBreadcrumb(chain) {
  const frag = document.createDocumentFragment();
  chain.forEach((n, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "crumb-sep";
      sep.textContent = "›";
      frag.appendChild(sep);
    }
    frag.appendChild(renderLabel(n));
  });
  return frag;
}

function renderLabel(node) {
  const crumb = document.createElement("span");
  crumb.className = "crumb";

  const rank = document.createElement("span");
  rank.className = "rank";
  rank.textContent = node.rank || "";
  crumb.appendChild(rank);

  const name = document.createElement("span");
  name.className = "name";
  const link = document.createElement("a");
  link.href = `https://www.inaturalist.org/taxa/${node.id}`;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = node.name;
  link.style.color = "inherit";
  link.style.textDecoration = "none";
  name.appendChild(link);
  crumb.appendChild(name);

  if (node.preferred_common_name) {
    const common = document.createElement("span");
    common.className = "common";
    common.textContent = `· ${node.preferred_common_name}`;
    crumb.appendChild(common);
  }
  return crumb;
}

// Walk the tree bottom-up: for each node, N = species-rank descendants
// (incl. self if the node is itself a species), Y = subset also in the
// user's observed-species set. Post-order so children are ready first.
function computeCoverage(roots, observedIds) {
  const visit = (node) => {
    for (const c of node.children) visit(c);
    if (node.rank === "species") {
      const seen = observedIds.has(node.id);
      node.coverage = { N: 1, Y: seen ? 1 : 0, pct: seen ? 100 : 0 };
      return;
    }
    let N = 0;
    let Y = 0;
    for (const c of node.children) {
      if (c.coverage && c.coverage !== "error") {
        N += c.coverage.N;
        Y += c.coverage.Y;
      }
    }
    const pct = N > 0 ? (Y / N) * 100 : 0;
    node.coverage = { N, Y, pct };
  };
  for (const r of roots) visit(r);
}

function renderCoverage(cov) {
  const el = document.createElement("span");
  el.className = "coverage";
  if (!cov || cov === "error") {
    el.textContent = cov === "error" ? "error" : "";
    return el;
  }
  if (cov.N === 0) {
    el.classList.add("empty");
    el.textContent = "no species data";
    return el;
  }
  const bar = document.createElement("span");
  bar.className = "bar";
  const fill = document.createElement("span");
  fill.style.width = `${Math.min(100, cov.pct).toFixed(1)}%`;
  bar.appendChild(fill);
  el.appendChild(bar);

  const txt = document.createElement("span");
  txt.textContent = `${cov.Y}/${cov.N} (${cov.pct.toFixed(1)}%)`;
  el.appendChild(txt);
  return el;
}

// Show the species list at the lowest non-species rank in each branch —
// typically genus. A node qualifies if it has no non-species children (all
// children are species, or there are no children at all) and is not itself
// a species.
function shouldSuggestAt(node) {
  if (node.rank === "species") return false;
  return node.children.every((c) => c.rank === "species");
}

function renderSpeciesList(node) {
  node.suggestion = "rendered";
  const species = node.children
    .filter((c) => c.rank === "species")
    .slice()
    .sort((a, b) => (b.direct_obs_count ?? 0) - (a.direct_obs_count ?? 0));

  const box = document.createElement("div");
  box.className = "suggestion-box";
  node._dom.body.appendChild(box);

  if (!species.length) {
    box.innerHTML = `<span class="no-suggestion">No species under this taxon.</span>`;
    return;
  }

  const unseen = species.filter((s) => !ctx.userObservedSpeciesIds.has(s.id));
  const heading = document.createElement("div");
  heading.className = "suggestion-heading";
  heading.textContent = `${species.length} species in region · ${unseen.length} not yet observed`;
  box.appendChild(heading);

  const list = document.createElement("ol");
  list.className = "species-list";
  for (const s of species) {
    const seen = ctx.userObservedSpeciesIds.has(s.id);
    const li = document.createElement("li");
    li.className = "species " + (seen ? "seen" : "unseen");

    const mark = document.createElement("span");
    mark.className = "mark";
    mark.textContent = seen ? "✓" : "·";
    li.appendChild(mark);

    const a = document.createElement("a");
    a.href = `https://www.inaturalist.org/taxa/${s.id}`;
    a.target = "_blank";
    a.rel = "noopener";
    a.className = "sp-name";
    a.textContent = s.name;
    li.appendChild(a);

    if (s.preferred_common_name) {
      const common = document.createElement("span");
      common.className = "common";
      common.textContent = ` · ${s.preferred_common_name}`;
      li.appendChild(common);
    }

    const count = document.createElement("span");
    count.className = "sp-count";
    const obs = s.direct_obs_count ?? 0;
    count.textContent = `${obs.toLocaleString()} obs`;
    li.appendChild(count);

    list.appendChild(li);
  }
  box.appendChild(list);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}
