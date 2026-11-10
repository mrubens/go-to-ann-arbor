// The full map's search (city-map.js): how well a typed text matches a place's or a street's name, and which wins.
// Plain data in, no page: node can run it against the real landmarks and streets.

/** A text's words: lower case, letters and digits ('Michigan Stadium (The Big House)' → michigan stadium the big house) */
const words = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/**
 * How well the query's words match a name: 0 named so exactly (a leading 'the' aside), 1 the name starts with them
 * (each word of the query a word of it in turn, the last the start of one: 'west park ba' → West Park Ball Field),
 * 2 every word of the query starts a word of it, anywhere ('park buhr', 'ball west'), 3 the text anywhere in it,
 * else Infinity. A leading word in `lead` may be left out: a place's 'the', a street's N, S, E or W ('main st' is
 * S Main St exactly)
 */
const THE = new Set(['the']), WAY = new Set(['n', 's', 'e', 'w']);
function nameRank(q, name, lead = THE) {
  if (!q.words.length) return Infinity;
  const n = words(name);
  const ranks = [];
  for (const w of lead.has(n[0]) && n.length > 1 ? [n, n.slice(1)] : [n]) {
    if (w.join(' ') === q.text) return 0;
    const last = q.words.length - 1;
    if (w.length > last && q.words.every((qw, i) => (i < last ? w[i] === qw : w[i].startsWith(qw)))) ranks.push(1);
  }
  if (ranks.length) return 1;
  const used = new Set();
  const all = q.words.every((qw) => {
    const i = n.findIndex((w, k) => !used.has(k) && w.startsWith(qw));
    if (i < 0) return false;
    used.add(i);
    return true;
  });
  if (all) return 2;
  return String(name).toLowerCase().includes(q.raw) || n.join(' ').includes(q.text) ? 3 : Infinity;
}

/** The query as nameRank reads it */
function parseQuery(text) {
  const raw = String(text || '').trim().toLowerCase();
  const w = words(raw);
  return { raw, words: w, text: w.join(' ') };
}

/**
 * The best place for the query among `places` ({ names: [..], tree? }): the best rank over its names (a champion tree
 * half a rank behind any other), then the shortest name of that rank (the closest match: 'west park' is West Park,
 * not West Park Ball Field). Returns { place, rank } or null
 */
function bestPlace(q, places) {
  let best = null, bestRank = Infinity, bestLen = Infinity;
  for (const p of places) {
    let rank = Infinity, len = Infinity;
    for (const name of p.names) {
      const r = nameRank(q, name);
      if (r < rank || (r === rank && name.length < len)) { rank = r; len = name.length; }
    }
    if (rank === Infinity) continue;
    rank += p.tree ? 0.5 : 0;
    if (rank < bestRank || (rank === bestRank && len < bestLen)) { best = p; bestRank = rank; bestLen = len; }
  }
  return best ? { place: best, rank: bestRank } : null;
}

/**
 * The streets for the query: every label ({ lower, raw }) with the text in its name or its survey name, highlighted,
 * and the best rank among them (as nameRank)
 */
function matchRoads(q, labels) {
  const roads = [];
  let rank = Infinity;
  if (!q.words.length) return { roads, rank };
  for (const l of labels) {
    const r = Math.min(nameRank(q, l.lower, WAY), nameRank(q, l.raw, WAY));
    if (r === Infinity) continue;
    roads.push(l);
    l.searchRank = r;
    rank = Math.min(rank, r);
  }
  return { roads, rank };
}

/**
 * Where the search goes: a place named exactly always; otherwise the streets when one matches word by word at least
 * as well as the best place ('maple' is Maple Rd, 'huron' Huron St over Huron High, but 'buhr' Buhr Park, 'west park
 * ball' West Park Ball Field); otherwise the best place, else the streets. Returns { place?, roads, roadRank }
 */
function rankSearch(text, places, labels) {
  const q = parseQuery(text);
  const hit = bestPlace(q, places);
  const { roads, rank: roadRank } = matchRoads(q, labels);
  let place = hit?.place || null;
  if (hit && hit.rank > 0 && roadRank <= 2 && roadRank <= hit.rank) place = null;
  return { q, place, roads, roadRank };
}

/**
 * The places to search: the map's landmarks (their names and short names) and the Teleport menu's places (`menu`:
 * { key, name } from its buttons, where `locations` has each one's arrival). A menu place that is a landmark adds its
 * menu name to it; each keeps the menu key it arrives by
 */
function searchPlaces(landmarks, menu = [], locations = {}) {
  const places = landmarks.map((l) => ({ names: [l.name, l.short], x: l.x, z: l.z, tree: l.art === 'tree', art: l.art, key: locations[l.id] ? l.id : null }));
  const byKey = new Map(places.map((p, i) => [landmarks[i].id, p]));
  for (const { key, name } of menu) {
    const loc = locations[key];
    if (!loc || !name) continue;
    const p = byKey.get(key);
    if (p) { if (!p.names.includes(name)) p.names.push(name); continue; }
    const added = { names: [name], x: loc.x, z: loc.z, key };
    byKey.set(key, added);
    places.push(added);
  }
  return places;
}

/**
 * The street to go to among the matches: the best rank, then one with the query's last word whole in it ('maple' is
 * Maple Rd, not Maplewood Ave), then a major street over a minor one ('state' is State St, not State Cir), then the
 * shortest name, its N, S, E or W aside ('huron' is Huron St)
 */
function bestRoad(q, roads) {
  const last = q.words[q.words.length - 1];
  const score = (l) => {
    const w = words(l.lower);
    return l.searchRank * 1000 + (w.includes(last) ? 0 : 500) + (l.major ? 0 : 200) + (WAY.has(w[0]) ? w.slice(1) : w).join(' ').length;
  };
  let best = null;
  for (const l of roads) if (!best || score(l) < score(best)) best = l;
  return best;
}

export { bestRoad, searchPlaces, words, nameRank, parseQuery, bestPlace, matchRoads, rankSearch };
