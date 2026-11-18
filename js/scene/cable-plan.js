// Cable plan for "Build by hand": every connection the build needs, from the real part data
// (24-pin, the board's CPU power sockets, the card's power sockets, SATA, front panel, USB,
// audio, fan and ARGB headers), with each connector's real name and the world position and
// direction of every port. Positions come from the same layout helpers the models are drawn
// from (board-layout.js, layout-board.js, layout.js), so a plug lands in the drawn socket.
// Pure (no three.js) so tools/test-cables.mjs can run it in Node.
//
// port:  one end a plug fits: { id, kind, at, owner, label, p: [x,y,z], dir: [x,y,z], multi }
// item:  one connection: { id, group, name, target, fromKind, toKind, from, to, required, cable, note }
import { psuSockets, driveSockets, WALL, cross } from './layout.js?v=5b4c14becb';
import { gpuPowerSockets, AIO_HEAD_H } from './layout-board.js?v=5b4c14becb';
import { boardPoint, Z, neg } from './layout-math.js?v=5b4c14becb';
import { adapterPlugs } from '../compat/power.js?v=5b4c14becb';

export const CABLE_GROUPS = Object.freeze([
  { id: 'power', label: 'Power' },
  { id: 'drives', label: 'Drives' },
  { id: 'front', label: 'Front panel' },
  { id: 'fans', label: 'Fans and lighting' },
]);

// Cable cross-section (cm, width x thickness; round when equal), plug head size and the
// straight lead out of the socket. `main` cables take the sleeved style.
export const CABLE_SPECS = Object.freeze({
  atx24: { w: 3.6, t: 0.65, head: [5.2, 1.0, 1.6], lead: 2.6, main: true, wires: 12 },
  eps8: { w: 1.3, t: 0.6, head: [1.9, 0.9, 1.4], lead: 2.0, main: true, wires: 4 },
  eps4: { w: 0.7, t: 0.6, head: [1.0, 0.9, 1.4], lead: 2.0, main: true, wires: 2 },
  pcie: { w: 1.3, t: 0.6, head: [2.1, 0.9, 1.4], lead: 2.0, main: true, wires: 4 },
  hpwr: { w: 1.2, t: 0.5, head: [1.95, 0.75, 1.3], lead: 2.0, main: true, wires: 6 },
  sataPower: { w: 1.1, t: 0.16, head: [2.2, 0.55, 0.9], lead: 1.4, wires: 5 },
  sataData: { w: 0.7, t: 0.14, head: [1.0, 0.5, 0.8], lead: 1.4 },
  fpanel: { w: 0.42, t: 0.42, head: [1.3, 0.6, 0.9], lead: 1.4 },
  usb3: { w: 0.62, t: 0.62, head: [2.0, 0.85, 1.2], lead: 1.6 },
  usbc: { w: 0.8, t: 0.22, head: [1.1, 0.7, 1.0], lead: 1.4 },
  audio: { w: 0.4, t: 0.4, head: [1.3, 0.6, 0.9], lead: 1.4 },
  fan: { w: 0.32, t: 0.32, head: [1.0, 0.55, 0.8], lead: 1.2 },
  argb: { w: 0.3, t: 0.3, head: [0.75, 0.55, 0.8], lead: 1.2 },
});

// Silk-screen names by board maker (numbering differs between boards; these are the usual ones).
const NAMES = {
  ASUS: { atx24: 'EATXPWR', eps: (i) => `EATX12V_${i + 1}`, cpuFan: 'CPU_FAN', pump: 'AIO_PUMP', sysFan: (i) => `CHA_FAN${i + 1}`, argb: (i) => `ADD_GEN2_${i + 1}`, fpanel: 'PANEL', audio: 'AAFP', sata: (i) => `SATA6G_${i + 1}` },
  MSI: { atx24: 'ATX_PWR1', eps: (i) => `CPU_PWR${i + 1}`, cpuFan: 'CPU_FAN1', pump: 'PUMP_FAN1', sysFan: (i) => `SYS_FAN${i + 1}`, argb: (i) => `JARGB_V2_${i + 1}`, fpanel: 'JFP1', audio: 'JAUD1', sata: (i) => `SATA${i + 1}` },
  Gigabyte: { atx24: 'ATX', eps: (i) => (i ? 'ATX_12V_2X2' : 'ATX_12V_2X4'), cpuFan: 'CPU_FAN', pump: 'CPU_OPT', sysFan: (i) => `SYS_FAN${i + 1}`, argb: (i) => `D_LED${i + 1}`, fpanel: 'F_PANEL', audio: 'F_AUDIO', sata: (i) => `SATA3 ${i}` },
  ASRock: { atx24: 'ATXPWR1', eps: (i) => `ATX12V${i + 1}`, cpuFan: 'CPU_FAN1', pump: 'AIO_PUMP', sysFan: (i) => `CHA_FAN${i + 1}`, argb: (i) => `ADDR_LED${i + 1}`, fpanel: 'PANEL1', audio: 'HD_AUDIO1', sata: (i) => `SATA3_${i}` },
};
const GENERIC = { atx24: 'ATX 24-pin', eps: (i) => `CPU_PWR${i + 1}`, cpuFan: 'CPU_FAN', pump: 'AIO_PUMP', sysFan: (i) => `SYS_FAN${i + 1}`, argb: (i) => `ARGB_${i + 1}`, fpanel: 'F_PANEL', audio: 'HD_AUDIO', sata: (i) => `SATA${i + 1}` };
const namesFor = (board) => NAMES[board?.brand] ?? GENERIC;
/** Connector names as this board's maker prints them (also drawn on the 3D board). */
export const silkNames = namesFor;

const add = (a, b, k = 1) => a.map((v, i) => v + b[i] * k);
const r2 = (v) => Math.round(v * 100) / 100;
const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };
/** World point / direction of a local point under a placement { p, ex, ey }. */
function at(pl, [x, y, z]) {
  const ez = cross(pl.ex, pl.ey);
  return [0, 1, 2].map((a) => r2(pl.p[a] + pl.ex[a] * x + pl.ey[a] * y + ez[a] * z));
}
function dirAt(pl, [x, y, z]) {
  const ez = cross(pl.ex, pl.ey);
  return norm([0, 1, 2].map((a) => pl.ex[a] * x + pl.ey[a] * y + ez[a] * z));
}
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * @param {object} build the whole build
 * @param {object} aplan planAssembly(build) (pieces with their keys, and the layout)
 */
export function planCables(build, aplan) {
  const L = aplan.layout;
  const out = { ready: false, reason: null, ports: new Map(), items: [], notes: [] };
  if (!L.board || !L.psu || !build.motherboard || !build.psu) {
    out.reason = 'Cables need a motherboard and a power supply in the build.';
    return out;
  }
  const board = build.motherboard;
  const psu = build.psu;
  const N = namesFor(board);
  const f = L.board.frame;
  const bl = L.board.layout;
  const cl = L.case;
  const pieceOf = (category, index = 0, unit = null) => [...aplan.pieces.values()].find((p) => p.category === category && p.index === index && (unit === null || p.unit === unit))?.key ?? null;
  const boardKey = pieceOf('motherboard');
  const psuKey = pieceOf('psu');

  const port = (p) => {
    out.ports.set(p.id, { multi: false, axis: null, ...p, p: p.p.map(r2), dir: norm(p.dir), axis: p.axis ? norm(p.axis) : null });
    return p.id;
  };
  const item = (it) => out.items.push({ required: false, note: null, ...it });

  // ---- PSU side: modular sockets in order (24-pin takes two), or the cable exit
  const face = psuSockets(psu);
  const pl = L.psu.placement;
  let next = 0;
  const psuPort = (kind, label, span = 1) => {
    const n = face.sockets.length;
    const idx = face.modular ? Math.min(next, n - 1) : 0;
    const s = face.sockets[idx];
    const s2 = span > 1 && face.modular ? face.sockets[Math.min(idx + 1, n - 1)] : s;
    const over = face.modular ? Math.max(0, next - (n - 1)) : 0;
    next += span;
    const local = [face.x + 0.15, (s.y + s2.y) / 2 + (face.modular ? over * 0.35 : 0), (s.z + s2.z) / 2];
    const id = `psu:${out.ports.size}`;
    return port({ id, kind, at: 'psu', owner: psuKey, label: face.modular ? label : 'PSU cable', p: at(pl, local), dir: dirAt(pl, [1, 0, 0]), axis: dirAt(pl, [0, 0, 1]), multi: !face.modular || over > 0 });
  };

  // ---- 24-pin
  const ab = bl.atx24;
  const atx = port({ id: 'board:atx24', kind: 'atx24', at: 'board', owner: boardKey, label: N.atx24, p: boardPoint(f, (ab.u0 + ab.u1) / 2, (ab.v0 + ab.v1) / 2, 1.6), dir: Z, axis: f.V });
  item({ id: 'atx24', group: 'power', name: '24-pin ATX power', target: N.atx24, fromKind: 'atx24', toKind: 'atx24', from: psuPort('atx24', '24-pin socket', 2), to: atx, required: true, cable: 'atx24' });

  // ---- CPU power: every socket the board has; the first is needed to boot
  const epsCables = psu.connectors?.eps8; // null = not in the data
  bl.eps.forEach((s, i) => {
    const kind = s.pins === 4 ? 'eps4' : 'eps8';
    const to = port({ id: `board:eps:${i}`, kind: 'eps', at: 'board', owner: boardKey, label: N.eps(i), p: boardPoint(f, (s.u0 + s.u1) / 2, (s.v0 + s.v1) / 2, 1.3), dir: Z, axis: f.U });
    const short = epsCables !== null && epsCables !== undefined && i >= epsCables;
    const name = s.pins === 4 ? 'CPU 4-pin (ATX12V)' : 'CPU 8-pin (EPS12V)';
    let note = null;
    if (!s.known) note = "This board's CPU power sockets aren't in the data: one 8-pin is the minimum every board needs.";
    else if (i > 0) note = 'Optional to boot; helps the CPU under heavy load.';
    if (short) note = `${psu.name} has ${plural(epsCables, 'CPU cable')}, so this socket stays empty. One is enough to boot.`;
    item({ id: `eps:${i}`, group: 'power', name, target: N.eps(i), fromKind: 'eps', toKind: 'eps', from: short ? null : psuPort('eps', 'CPU socket'), to, required: i === 0, cable: kind, note, unavailable: short });
  });

  // ---- graphics card power
  if (build.gpu && L.gpu) {
    const g = build.gpu;
    const known = Array.isArray(g.powerConnectors);
    const list = known ? g.powerConnectors : ['8-pin'];
    const sockets = gpuPowerSockets({ ...g, powerConnectors: list });
    const c = psu.connectors ?? {};
    const gpuKey = pieceOf('gpu');
    if (known && !list.length) out.notes.push(`${g.name} takes its power from the PCIe slot: no power cable.`);
    let pcieLeft = c.pcie8 ?? Infinity;
    let hpwrLeft = c.pcie16 ?? 0;
    sockets.forEach((s, i) => {
      const hp = s.kind === '16-pin';
      const to = port({ id: `gpu:${i}`, kind: hp ? 'hpwr' : 'pcie', at: 'gpu', owner: gpuKey, label: `${g.chip ?? 'GPU'} ${s.kind}`, p: at(L.gpu.placement, [(s.x0 + s.x1) / 2, s.y, s.z]), dir: dirAt(L.gpu.placement, [0, 1, 0]), axis: L.gpu.placement.ex });
      if (hp) {
        const native = hpwrLeft > 0;
        hpwrLeft--;
        const plugs = g.tdp ? adapterPlugs(g) : 2;
        if (!native) pcieLeft -= plugs;
        item({
          id: `gpu:${i}`, group: 'power', name: native ? '12V-2x6 (16-pin)' : `16-pin adapter on ${plural(plugs, 'PCIe 8-pin plug')}`,
          target: `${g.chip ?? 'Graphics card'} power socket`, fromKind: native ? 'hpwr' : 'pcie', toKind: 'hpwr',
          from: psuPort(native ? 'hpwr' : 'pcie', native ? '12V-2x6 socket' : 'PCIe sockets'), to, required: true, cable: 'hpwr',
          note: native ? null : `${psu.name} has no native 16-pin cable: the adapter in the card's box takes ${plural(plugs, 'PCIe 8-pin plug')}.`,
        });
      } else {
        const short = pcieLeft <= 0;
        pcieLeft--;
        item({
          id: `gpu:${i}`, group: 'power', name: s.kind === '6-pin' ? 'PCIe 6-pin (6+2 plug)' : 'PCIe 8-pin (6+2)',
          target: `${g.chip ?? 'Graphics card'} socket ${i + 1}`, fromKind: 'pcie', toKind: 'pcie', from: short ? null : psuPort('pcie', 'PCIe socket'), to,
          required: true, cable: 'pcie', unavailable: short,
          note: !known ? "The card's power connectors aren't in the data: drawn as one 8-pin." : short ? `${psu.name} has no PCIe plug left for this socket.` : null,
        });
      }
    });
  }

  // ---- SATA drives: power from the PSU, data to the board
  let sataUsed = 0;
  L.storage.forEach((s) => {
    if (s.kind === 'm2' || !s.placement) return;
    const part = build.storage[s.index];
    const sk = driveSockets(s.kind);
    if (!sk) return;
    const key = pieceOf('storage', s.index);
    const dir = dirAt(s.placement, [-1, 0, 0]);
    const name = part?.name ?? 'SATA drive';
    const pw = port({ id: `drive:${s.index}:power`, kind: 'sataPower', at: 'drive', owner: key, label: `${name} power`, p: at(s.placement, [sk.x - 0.1, ...sk.power.slice(1)]), dir, axis: dirAt(s.placement, [0, 1, 0]) });
    item({ id: `sata-power:${s.index}`, group: 'drives', name: 'SATA power (15-pin)', target: name, fromKind: 'sataPower', toKind: 'sataPower', from: psuPort('sataPower', 'SATA socket'), to: pw, required: true, cable: 'sataPower' });
    const portOnBoard = bl.sata[sataUsed];
    const data = port({ id: `drive:${s.index}:data`, kind: 'sataDrive', at: 'drive', owner: key, label: `${name} data`, p: at(s.placement, [sk.x - 0.1, ...sk.data.slice(1)]), dir, axis: dirAt(s.placement, [0, 1, 0]) });
    if (!portOnBoard) {
      out.notes.push(`${name}: the board has no SATA port left in the data.`);
      return;
    }
    const to = port({ id: `board:sata:${sataUsed}`, kind: 'sataData', at: 'board', owner: boardKey, label: N.sata(sataUsed), p: boardPoint(f, portOnBoard.u + 0.6, portOnBoard.v, portOnBoard.dz), dir: f.U, axis: f.V });
    item({ id: `sata-data:${s.index}`, group: 'drives', name: 'SATA data (7-pin)', target: N.sata(sataUsed), fromKind: 'sataDrive', toKind: 'sataData', from: data, to, required: true, cable: 'sataData' });
    sataUsed++;
  });

  // ---- headers on the board
  const headers = bl.headers.map((h, i) => ({ ...h, i, p: boardPoint(f, h.u, h.v, h.kind === 'usb3' ? 0.95 : 0.85) }));
  const headerPort = (h, label) => port({ id: `board:hdr:${h.i}`, kind: h.kind, at: 'board', owner: boardKey, label, p: h.p, dir: Z, axis: h.du >= h.dv ? f.U : f.V });
  const ofKind = (k) => headers.filter((h) => h.kind === k);

  // Front-panel cables hang from the front I/O: behind the tray when there is room, else in front of it.
  const ioX = cl.D / 2 - WALL - cl.frontReserve - 1.4;
  const ioZ = cl.rearSpace >= 1.2 ? cl.trayZ - cl.rearSpace / 2 : cl.trayZ + 1.4;
  let ioN = 0;
  const casePort = (kind, label) => port({ id: `case:${kind}`, kind: `case-${kind}`, at: 'case', owner: null, label, p: [ioX - (ioN % 2) * 0.9, cl.H - WALL - 3.2 - (ioN++) * 1.1, ioZ], dir: [0, -1, 0], axis: [1, 0, 0] });
  const io = build.case?.frontIO ?? null;
  const fp = ofKind('fpanel')[0];
  if (fp) item({ id: 'fpanel', group: 'front', name: 'Front panel (power switch, reset, LEDs)', target: N.fpanel, fromKind: 'case-fpanel', toKind: 'fpanel', from: casePort('fpanel', 'Front-panel leads'), to: headerPort(fp, N.fpanel), required: true, cable: 'fpanel' });
  const u3 = ofKind('usb3')[0];
  if (u3 && (io?.usbA ?? 1) > 0) item({ id: 'usb3', group: 'front', name: 'USB 3.2 Gen 1 (19-pin)', target: 'USB 3 header', fromKind: 'case-usb3', toKind: 'usb3', from: casePort('usb3', 'Front USB 3 cable'), to: headerPort(u3, 'USB 3 header'), cable: 'usb3', note: io ? null : 'Front USB ports are not in the data for this case; most cases have USB 3 Type-A ports.' });
  const uc = ofKind('usbc')[0];
  if (uc && (io?.usbC ?? 1) > 0) item({ id: 'usbc', group: 'front', name: 'USB-C front (Key-A, 20-pin)', target: 'USB-C header', fromKind: 'case-usbc', toKind: 'usbc', from: casePort('usbc', 'Front USB-C cable'), to: headerPort(uc, 'USB-C header'), cable: 'usbc', note: io ? null : 'Front USB-C is not in the data for this case: connect it if the case has one.' });
  if (io?.usbC === 0) out.notes.push(`${build.case.name} has no front USB-C port.`);
  const au = ofKind('audio')[0];
  if (au) item({ id: 'audio', group: 'front', name: 'HD Audio (front jacks)', target: N.audio, fromKind: 'case-audio', toKind: 'audio', from: casePort('audio', 'Front audio cable'), to: headerPort(au, N.audio), cable: 'audio' });

  // ---- fans and lighting
  const sys = ofKind('sysFan').map((h, i) => ({ h, name: N.sysFan(i), used: 0 }));
  const argb = ofKind('argb').map((h, i) => ({ h, name: N.argb(i), used: 0 }));
  const take = (list, from) => {
    if (!list.length) return null;
    const free = list.filter((x) => !x.used);
    const pick = (free.length ? free : list).reduce((a, b) => (dist(a.h.p, from) <= dist(b.h.p, from) ? a : b));
    pick.used++;
    return pick;
  };
  const toHeader = (x) => {
    const id = `board:hdr:${x.h.i}`;
    if (!out.ports.has(id)) headerPort(x.h, x.name);
    if (x.used > 1) out.ports.get(id).multi = true;
    return id;
  };
  // Cable exit of a fan: the frame corner nearest `toward`.
  const fanExit = (fan, toward) => {
    const s = fan.size / 2 - 0.7;
    const corners = [[s, s], [s, -s], [-s, s], [-s, -s]].map(([x, y]) => ({ p: at(fan.placement, [x, y, -fan.depth / 2 + 0.3]), d: dirAt(fan.placement, [x, y, 0]) }));
    return corners.reduce((a, b) => (dist(a.p, toward) <= dist(b.p, toward) ? a : b));
  };

  const cooler = build.cooler;
  const cpuFanH = ofKind('cpuFan')[0];
  const pumpH = ofKind('pump')[0];
  if (cooler && L.cooler) {
    const s = bl.socket;
    if (L.cooler.kind === 'aio') {
      const head = pieceOf('cooler', 0, 0);
      const pumpAt = { p: boardPoint(f, s.u + 2.4, s.v - 1.6, AIO_HEAD_H - 1.6), d: f.U };
      if (pumpH) {
        const from = port({ id: 'cooler:pump', kind: 'fan', at: 'cooler', owner: head, label: 'Pump cable', p: pumpAt.p, dir: pumpAt.d });
        item({ id: 'pump', group: 'fans', name: 'AIO pump (4-pin)', target: N.pump, fromKind: 'fan', toKind: 'pump', from, to: headerPort(pumpH, N.pump), required: true, cable: 'fan' });
      }
      const rad = L.cooler.radiator;
      if (rad && cpuFanH) {
        const radKey = pieceOf('cooler', 0, 1);
        const target = boardPoint(f, cpuFanH.u, cpuFanH.v, 0.85);
        const half = rad.ext.map((e) => e / 2 - 1.2);
        const inner = add(rad.placement.p, rad.outward, -(rad.spec.stack / 2) + 0.2);
        const corners = [];
        for (const a of [-1, 1]) for (const b of [-1, 1]) {
          const p = [...inner];
          const axes = [0, 1, 2].filter((i) => rad.outward[i] === 0);
          p[axes[0]] += a * half[axes[0]];
          p[axes[1]] += b * half[axes[1]];
          corners.push(p);
        }
        const p = corners.reduce((x, y) => (dist(x, target) <= dist(y, target) ? x : y));
        const n = rad.spec.n;
        const from = port({ id: 'cooler:radfans', kind: 'fan', at: 'cooler', owner: radKey, label: 'Radiator fan cable', p, dir: neg(rad.outward) });
        item({ id: 'cpu-fan', group: 'fans', name: `Radiator fans (${n} × 4-pin PWM)`, target: N.cpuFan, fromKind: 'fan', toKind: 'cpuFan', from, to: headerPort(cpuFanH, N.cpuFan), required: true, cable: 'fan', note: n > 1 ? 'On the splitter that comes with the cooler.' : null });
      }
      if (cooler.rgb) {
        const x = take(argb, pumpAt.p);
        if (x) item({ id: 'argb:cooler', group: 'fans', name: 'ARGB 5V 3-pin (pump and fans)', target: x.name, fromKind: 'argb', toKind: 'argb', from: port({ id: 'cooler:argb', kind: 'argb', at: 'cooler', owner: head, label: 'Cooler ARGB cable', p: add(pumpAt.p, f.V, 0.6), dir: pumpAt.d }), to: toHeader(x), cable: 'argb' });
      }
    } else if (cpuFanH) {
      const low = L.cooler.height < 8;
      const key = pieceOf('cooler');
      const fanAt = low
        ? { p: boardPoint(f, s.u + 4.2, s.v - 4.2, L.cooler.height - 1.2), d: neg(f.V) }
        : { p: boardPoint(f, s.u + 5.0, s.v - 5.6, Math.min(L.cooler.height * 0.45, 7)), d: f.U };
      const n = cooler.fans ?? 1;
      item({ id: 'cpu-fan', group: 'fans', name: `CPU fan${n > 1 ? `s (${n} × 4-pin PWM)` : ' (4-pin PWM)'}`, target: N.cpuFan, fromKind: 'fan', toKind: 'cpuFan', from: port({ id: 'cooler:fan', kind: 'fan', at: 'cooler', owner: key, label: 'CPU fan cable', p: fanAt.p, dir: fanAt.d }), to: headerPort(cpuFanH, N.cpuFan), required: true, cable: 'fan', note: n > 1 ? 'Both fans on the Y-splitter that comes with the cooler.' : null });
      if (cooler.rgb) {
        const x = take(argb, fanAt.p);
        if (x) item({ id: 'argb:cooler', group: 'fans', name: 'ARGB 5V 3-pin (cooler)', target: x.name, fromKind: 'argb', toKind: 'argb', from: port({ id: 'cooler:argb', kind: 'argb', at: 'cooler', owner: key, label: 'Cooler ARGB cable', p: add(fanAt.p, f.V, 0.6), dir: fanAt.d }), to: toHeader(x), cable: 'argb' });
      }
    }
  }

  // Case fans: one cable per run of fans of one part on one mount (daisy-chained or on a splitter).
  const runs = [];
  for (const fan of L.fans) {
    const last = runs[runs.length - 1];
    if (last && last.partIndex === fan.partIndex && last.mount === fan.mount) last.fans.push(fan);
    else runs.push({ partIndex: fan.partIndex, mount: fan.mount, fans: [fan] });
  }
  const MOUNT = { front: 'Front', top: 'Top', rear: 'Rear', bottom: 'Bottom', side: 'Side', shroud: 'Shroud' };
  runs.forEach((run, k) => {
    const part = build.fans[run.partIndex];
    const centre = run.fans[run.fans.length - 1].placement.p;
    const x = take(sys, centre);
    if (!x) return;
    // Exit from the fan in the run nearest the header.
    const fan = run.fans.reduce((a, b) => (dist(a.placement.p, x.h.p) <= dist(b.placement.p, x.h.p) ? a : b));
    const exit = fanExit(fan, x.h.p);
    const owner = pieceOf('fans', fan.partIndex, fan.unit);
    const n = run.fans.length;
    const label = `${MOUNT[run.mount] ?? 'Case'} fan${n > 1 ? 's' : ''}`;
    const from = port({ id: `fan:${k}`, kind: 'fan', at: 'fan', owner, label: `${label} cable`, p: exit.p, dir: exit.d });
    const note = [n > 1 ? `${n} fans daisy-chained or on a splitter.` : null, x.used > 1 ? 'More fan runs than headers: shares the header through a hub.' : null].filter(Boolean).join(' ') || null;
    item({ id: `fan:${k}`, group: 'fans', name: `${label} (${n > 1 ? `${n} × ` : ''}4-pin PWM)`, target: x.name, fromKind: 'fan', toKind: 'sysFan', from, to: toHeader(x), cable: 'fan', note });
    if (part?.rgb) {
      const a = take(argb, exit.p);
      if (a) {
        const fromA = port({ id: `fan:${k}:argb`, kind: 'argb', at: 'fan', owner, label: `${label} ARGB cable`, p: add(exit.p, exit.d, -0.5), dir: exit.d });
        item({ id: `argb:fan:${k}`, group: 'fans', name: `ARGB 5V 3-pin (${label.toLowerCase()})`, target: a.name, fromKind: 'argb', toKind: 'argb', from: fromA, to: toHeader(a), cable: 'argb', note: a.used > 1 ? 'Daisy-chained with another ARGB run on this header.' : null });
      }
    }
  });

  out.ready = true;
  return out;
}

/** Ports a connected cable occupies, given its stored source/target overrides. */
export const endsOf = (item, state) => ({ from: state?.src ?? item.from, to: state?.dst ?? item.to });

/** Connections that must be in before the PC can power on, and which are still missing. */
export function powerReady(cplan, cables) {
  const missing = cplan.items.filter((it) => it.required && !it.unavailable && !cables[it.id]);
  return { ok: cplan.ready && missing.length === 0, missing };
}
