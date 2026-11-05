import * as THREE from 'three/webgpu';
import { GEO } from './city-geodata.js';
import { LANDMARKS, ROADS, nearestRoads } from './city-config.js';
import { groundHeight } from './terrain.js';
import { hot, load, save, log } from '../lamp-game.js';

const live = hot(import.meta);
const navState = live.state('destination', { version: 1, start: () => ({ target: load('driving-destination') || null }) });
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const distance = m => m < 161 ? `${Math.max(10, Math.round(m * 3.28084 / 10) * 10)} ft` : `${(m / 1609.344).toFixed(1)} mi`;
const normalized = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function catalog() {
  const list = LANDMARKS.map(p => ({ name: p.name, x: p.x, z: p.z, type: 'Landmark', aliases: p.short || '' }));
  const signs = GEO.signs || {};
  for (let i = 0; i < (signs.list?.length || 0); i += 7) {
    const a = signs.list;
    list.push({ name: signs.names[a[i + 5]], x: a[i], z: a[i + 1], type: ['Food', 'Coffee & sweets', 'Bar', 'Shop', 'Service', 'Culture'][a[i + 6]] || 'Business' });
  }
  const seen = new Set();
  for (const r of ROADS) {
    if (!r.name || seen.has(r.name) || !r.pts?.length) continue;
    seen.add(r.name);
    const p = r.pts[Math.floor(r.pts.length / 2)];
    if (p && Number.isFinite(p.x)) list.push({ name: r.name, x: p.x, z: p.z, type: 'Street' });
  }
  return list.filter(p => p.name && Number.isFinite(p.x) && Number.isFinite(p.z)).map(p => ({ ...p, search: normalized(`${p.name} ${p.aliases || ''}`) }));
}

class Heap {
  constructor() { this.a = []; }
  push(e, cost) {
    const a = this.a, item = { e, cost }; let i = a.length; a.push(item);
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].cost <= cost) break; a[i] = a[p]; i = p; } a[i] = item;
  }
  pop() {
    const a = this.a, first = a[0], last = a.pop();
    if (a.length) { let i = 0; while (i * 2 + 1 < a.length) { let c = i * 2 + 1; if (c + 1 < a.length && a[c + 1].cost < a[c].cost) c++; if (a[c].cost >= last.cost) break; a[i] = a[c]; i = c; } a[i] = last; }
    return first;
  }
}

function snap(e, p) {
  const lane = e.lanes[Math.floor(e.lanes.length / 2)] || 0;
  const x = e.x0 + e.rx * lane, z = e.z0 + e.rz * lane;
  const t = clamp(((p.x - x) * e.dx + (p.z - z) * e.dz) / e.span, 0, 1);
  const px = x + e.dx * e.span * t, pz = z + e.dz * e.span * t;
  return { e, t, x: px, z: pz, d: Math.hypot(px - p.x, pz - p.z) };
}

export class DrivingNavigation {
  constructor(scene, map, controllers, network, confirm) {
    this.map = map; this.controllers = controllers; this.network = network;
    this.confirm = confirm;
    this.places = catalog(); this.points = []; this.turns = []; this.routeEdges = [];
    this.target = navState.target; this.clock = 0; this.nextUpdate = 0; this.nextRoute = 0; this.routeVersion = 0;
    this.panel = document.getElementById('driving-directions');
    this.arrow = document.getElementById('nav-arrow'); this.instruction = document.getElementById('nav-turn');
    this.street = document.getElementById('nav-street'); this.destination = document.getElementById('nav-destination');
    this.remaining = document.getElementById('nav-remaining'); this.results = document.getElementById('destination-results');
    this.geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(180000);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setDrawRange(0, 0);
    this.material = new THREE.MeshBasicNodeMaterial({ color: 0xffcb05, transparent: true, opacity: 0.65, depthWrite: false, side: THREE.DoubleSide });
    this.ribbon = new THREE.Mesh(this.geometry, this.material); this.ribbon.name = 'Driving route on the road';
    this.ribbon.frustumCulled = false; this.ribbon.renderOrder = 5; scene.add(this.ribbon);
    document.getElementById('nav-stop')?.addEventListener('click', () => this.clear());
    const field = map.elSearchInput;
    if (field) {
      field.placeholder = 'Where to? Places, businesses, streets';
      field.addEventListener('input', () => this.search(field.value));
      field.addEventListener('focus', () => this.search(field.value));
      field.addEventListener('keydown', e => {
        if (e.code === 'Enter' || e.code === 'ArrowDown') {
          e.preventDefault(); e.stopPropagation();
          const first = this.results.querySelector('button');
          if (e.code === 'Enter') first?.click(); else first?.focus();
        }
      });
    }
    this.results?.addEventListener('keydown', e => {
      if (!['ArrowDown', 'ArrowUp'].includes(e.code)) return;
      e.preventDefault(); e.stopPropagation();
      const buttons = [...this.results.querySelectorAll('button')], i = buttons.indexOf(document.activeElement);
      buttons[clamp(i + (e.code === 'ArrowDown' ? 1 : -1), 0, buttons.length - 1)]?.focus();
    });
    map.navigation = this;
    if (this.target) { map.waypoint = this.target; this.plan(); }
  }

  search(query) {
    const q = normalized(query), p = this.controllers.getActiveEntity().position;
    const hits = this.places.filter(a => !q || q.split(' ').every(w => a.search.includes(w)));
    hits.sort((a, b) => Number(b.search.startsWith(q)) - Number(a.search.startsWith(q)) || Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
    this.results.replaceChildren();
    for (const place of hits.slice(0, 9)) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'destination-result';
      button.textContent = place.name;
      const info = document.createElement('small'); info.textContent = `${place.type} · ${distance(Math.hypot(place.x - p.x, place.z - p.z))} away · Get directions`;
      button.append(info); button.addEventListener('click', () => this.choose(place)); this.results.append(button);
    }
    if (!hits.length) { const empty = document.createElement('div'); empty.className = 'destination-empty'; empty.textContent = 'No mapped places found. Try a street or click the map.'; this.results.append(empty); }
  }

  choose(place) {
    this.target = { name: place.name, x: place.x, z: place.z };
    navState.target = this.target; save('driving-destination', this.target); this.map.waypoint = this.target;
    this.results.replaceChildren(); this.plan(); this.map.toggleFullMap(false);
    this.confirm?.();
    log(`[directions] destination: ${place.name}`);
  }

  clear() {
    this.target = navState.target = this.map.waypoint = null; save('driving-destination', null);
    this.points = []; this.routeEdges = []; this.geometry.setDrawRange(0, 0); this.panel.classList.add('hidden');
    this.map.renderFullMap(); log('[directions] ended');
  }

  nearest(p) {
    const found = [];
    for (const e of this.network.edges) {
      if (e.closed || !e.lanes?.length || e.span <= 0) continue;
      const s = snap(e, p); let i = found.findIndex(a => s.d < a.d);
      if (i < 0) i = found.length;
      if (i < 8) { found.splice(i, 0, s); if (found.length > 8) found.pop(); }
    }
    return found;
  }

  plan() {
    this.nextRoute = this.clock + 3;
    this.points = []; this.turns = []; this.routeEdges = []; this.geometry.setDrawRange(0, 0);
    const ent = this.controllers.getActiveEntity(), starts = this.nearest(ent.position), ends = this.nearest(this.target);
    if (!starts.length || !ends.length) { this.problem = 'No nearby driving road'; return; }
    const nearest = starts[0].d;
    const heading = ent.heading + (ent.speed < -0.5 ? Math.PI : 0);
    starts.sort((a, b) => (a.d + (1 - a.e.dx * Math.sin(heading) - a.e.dz * Math.cos(heading)) * 12)
      - (b.d + (1 - b.e.dx * Math.sin(heading) - b.e.dz * Math.cos(heading)) * 12));
    const start = starts.find(s => s.d <= nearest + 12) || starts[0];
    const goals = new Map(ends.filter(s => s.d <= ends[0].d + 10).map(s => [s.e, s]));
    const heap = new Heap(), costs = new Map(), parents = new Map();
    let best = Infinity, finish = null, direct = null;
    const same = goals.get(start.e);
    if (same && same.t >= start.t) { best = (same.t - start.t) * start.e.span + same.d; direct = same; }
    for (const m of start.e.moves) {
      if (m.to.closed || !m.out.some(i => i >= 0)) continue;
      const cost = (1 - start.t) * start.e.span;
      costs.set(m.to, cost); parents.set(m.to, null); heap.push(m.to, cost);
    }
    while (heap.a.length) {
      const { e, cost } = heap.pop();
      if (cost !== costs.get(e)) continue;
      if (cost > best) break;
      const goal = goals.get(e);
      if (goal && cost + goal.t * e.span + goal.d < best) { best = cost + goal.t * e.span + goal.d; finish = e; direct = null; }
      for (const m of e.moves) {
        const f = m.to;
        if (f.closed || !m.out.some(i => i >= 0)) continue;
        const next = cost + e.span + (m.turn === 'S' ? 0 : 5);
        if (next >= (costs.get(f) ?? Infinity)) continue;
        costs.set(f, next); parents.set(f, e); heap.push(f, next);
      }
    }
    if (!finish && !direct) { this.problem = 'No connected driving route'; return; }
    this.problem = ''; this.startOffset = start.d;
    const chain = [];
    for (let e = finish; e; e = parents.get(e)) chain.push(e);
    chain.reverse(); chain.unshift(start.e); this.routeEdges = chain;
    const end = direct || goals.get(finish);
    this.endOffset = end.d;
    let total = 0;
    const add = (x, z, street) => {
      const prev = this.points[this.points.length - 1];
      if (prev) { const d = Math.hypot(x - prev.x, z - prev.z); if (d < 0.05) return; total += d; }
      this.points.push({ x, z, s: total, street: street || 'the road' });
    };
    let incomingLane = Math.floor(chain[0].lanes.length / 2);
    const curveSample = {};
    const names = new Map();
    const streetName = e => {
      if (!names.has(e)) names.set(e, e.street || nearestRoads(e.x0 + e.dx * e.span / 2, e.z0 + e.dz * e.span / 2, 160)[0]?.road.name || 'the next road');
      return names.get(e);
    };
    for (let k = 0; k < chain.length; k++) {
      const e = chain[k], f = chain[k + 1];
      const move = f ? e.moves.find(m => m.to === f) : null;
      let outgoingLane = incomingLane;
      if (move && move.out[outgoingLane] < 0) outgoingLane = move.out.findIndex(i => i >= 0);
      const nextLane = move ? move.out[outgoingLane] : 0;
      const begin = (e.sx - e.x0) * e.dx + (e.sz - e.z0) * e.dz;
      const stop = begin + e.len;
      const from = k === 0 ? Math.min(start.t * e.span, stop) : begin;
      const to = k === chain.length - 1 ? Math.max(from, end.t * e.span) : Math.max(from, stop);
      const steps = Math.max(1, Math.ceil((to - from) / 3));
      for (let j = 0; j <= steps; j++) {
        const t = j / steps, u = from + (to - from) * t;
        const lane = e.lanes[incomingLane] + (e.lanes[outgoingLane] - e.lanes[incomingLane]) * t;
        add(e.x0 + e.dx * u + e.rx * lane, e.z0 + e.dz * u + e.rz * lane, streetName(e));
      }
      if (f) {
        const cross = e.dx * f.dz - e.dz * f.dx, dot = e.dx * f.dx + e.dz * f.dz;
        if (dot < 0.90 || (e.street && f.street && e.street !== f.street)) this.turns.push({ s: total, street: streetName(f), arrow: dot < -0.5 ? '↶' : cross > 0.22 ? '↱' : cross < -0.22 ? '↰' : '↑', action: dot < -0.5 ? 'Turn around' : cross > 0.22 ? 'Turn right' : cross < -0.22 ? 'Turn left' : 'Continue' });
        const curve = this.network.connector(e, outgoingLane, f, nextLane);
        const count = Math.max(1, Math.ceil(curve.len / 3));
        for (let j = 1; j <= count; j++) { this.network.curvePoint(curve, curve.len * j / count, curveSample); add(curveSample.x, curveSample.z, streetName(f)); }
        incomingLane = nextLane;
      }
    }
    this.total = total; this.progress = 0; this.makeRibbon(); this.routeVersion++;
  }

  makeRibbon() {
    let n = 0;
    for (let i = 1; i < this.points.length && n + 18 <= this.positions.length; i++) {
      const a = this.points[i - 1], b = this.points[i], len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const nx = -(b.z - a.z) / len * 0.65, nz = (b.x - a.x) / len * 0.65;
      for (const [p, side] of [[a, 1], [a, -1], [b, 1], [a, -1], [b, -1], [b, 1]]) {
        const x = p.x + nx * side, z = p.z + nz * side;
        this.positions[n++] = x; this.positions[n++] = groundHeight(x, z) + 0.18; this.positions[n++] = z;
      }
    }
    this.vertexCount = n / 3; this.geometry.attributes.position.needsUpdate = true; this.geometry.setDrawRange(0, this.vertexCount);
  }

  update(dt) {
    this.clock += dt; if (this.clock < this.nextUpdate) return; this.nextUpdate = this.clock + 0.15;
    this.panel.classList.toggle('hidden', !this.target || this.map.isFullMapOpen);
    this.ribbon.visible = !!this.target && this.controllers.activeMode !== 'helicopter' && this.controllers.activeMode !== 'plane';
    if (!this.target) return;
    const ent = this.controllers.getActiveEntity(), p = ent.position;
    this.destination.textContent = this.target.name;
    if (!this.points.length) {
      this.arrow.textContent = '!'; this.instruction.textContent = this.problem || 'Finding route';
      this.street.textContent = 'Try a nearby street or another destination'; this.remaining.textContent = '';
      if (this.clock >= this.nextRoute) this.plan(); return;
    }
    let best = this.points.length === 1 ? Math.hypot(p.x - this.points[0].x, p.z - this.points[0].z) : Infinity, at = 0, along = 0;
    for (let i = 1; i < this.points.length; i++) {
      const a = this.points[i - 1], b = this.points[i], dx = b.x - a.x, dz = b.z - a.z;
      const t = clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      const d = Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
      if (d < best) { best = d; along = a.s + (b.s - a.s) * t; at = i - 1; }
    }
    this.progress = along;
    const a = this.points[at], b = this.points[at + 1];
    const direction = ent.heading + (ent.speed < -0.5 ? Math.PI : 0);
    const wrongWay = b && Math.abs(ent.speed) > 2 && ((b.x - a.x) * Math.sin(direction) + (b.z - a.z) * Math.cos(direction)) < -0.5 * (b.s - a.s);
    if (this.clock >= this.nextRoute && (best > 32 || wrongWay || this.routeEdges.some(e => e.closed))) { this.plan(); return; }
    const remaining = Math.max(0, this.total - along), near = Math.hypot(p.x - this.target.x, p.z - this.target.z);
    const turn = this.turns.find(t => t.s > along - 4);
    const arrived = near < 25 || (remaining < 15 && best < 25);
    if (arrived) {
      this.arrow.textContent = '⚑'; this.instruction.textContent = near < 25 ? 'You have arrived' : 'Destination nearby';
      this.street.textContent = near < 25 ? this.target.name : `${distance(near)} from the road`; this.remaining.textContent = 'End directions or choose another place';
      this.geometry.setDrawRange(0, 0); return;
    }
    this.arrow.textContent = best > 32 ? '↗' : turn?.arrow || '↑';
    this.instruction.textContent = best > 32 ? 'Join the highlighted road' : turn ? turn.s - along < 10 ? `${turn.action} now` : `${turn.action} in ${distance(turn.s - along)}` : `Continue for ${distance(remaining)}`;
    this.street.textContent = turn ? `onto ${turn.street}` : `toward ${this.target.name}`;
    this.remaining.textContent = `${distance(remaining)} remaining${this.endOffset > 25 ? ' · ends at nearest road' : ''}`;
    // Hide road ribbon behind the driver; the whole route remains on the maps.
    this.geometry.setDrawRange(Math.min(this.vertexCount, at * 6), Math.max(0, this.vertexCount - at * 6));
  }

  drawMap(ctx, v, width) {
    if (!this.target || !this.points.length) return;
    ctx.save(); ctx.beginPath();
    for (let i = 0; i < this.points.length; i++) { const p = this.points[i]; if (!i) ctx.moveTo(v.toX(p.x), v.toY(p.z)); else ctx.lineTo(v.toX(p.x), v.toY(p.z)); }
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = '#17202c'; ctx.lineWidth = width + 3; ctx.stroke();
    ctx.strokeStyle = '#ffcb05'; ctx.lineWidth = width; ctx.stroke(); ctx.restore();
  }

  dispose() { this.ribbon.removeFromParent(); this.geometry.dispose(); this.material.dispose(); }
}

hot(import.meta).accept();
