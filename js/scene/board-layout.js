// Where things sit on a motherboard, per form factor. Pure maths (no three.js) so the
// Node layout test can use it. Units: cm. Board-local coords: u = distance from the rear
// (I/O) edge toward the case front, v = distance down from the top edge.
// Real boards differ in detail; these follow the common ATX / mATX / Mini-ITX layouts.

export const BOARD_DIMS = Object.freeze({
  'E-ATX': { w: 33.0, h: 30.5 },
  ATX: { w: 24.4, h: 30.5 },
  mATX: { w: 24.4, h: 24.4 },
  ITX: { w: 17.0, h: 17.0 },
});

// Largest first, for "the biggest board this case takes".
export const FORM_FACTORS = ['E-ATX', 'ATX', 'mATX', 'ITX'];

export const PCIE_PITCH = 2.032; // 0.8 in between expansion slots
const SLOT_LEN = { x1: 2.5, x4: 3.9, x8: 5.6, x16: 8.9 };
const SLOT_U0 = 4.2; // rear end of a PCIe slot, from the board's rear edge

// Board-relative v of each expansion slot position. ATX has 7, mATX 4, ITX 1.
export function slotRowV(ff, k) {
  return (ff === 'ITX' ? 15.6 : 16.6) + k * PCIE_PITCH;
}
export const SLOT_ROWS = { 'E-ATX': 7, ATX: 7, mATX: 4, ITX: 1 };

// Which slot positions a board with n slots uses (typical spacing, x16 slot first).
function slotPositions(ff, n) {
  if (ff === 'ITX') return [0];
  if (ff === 'mATX') return [[0], [0, 3], [0, 2, 3], [0, 1, 2, 3]][Math.min(n, 4) - 1] ?? [];
  const atx = [[1], [1, 4], [1, 4, 6], [1, 2, 4, 6], [0, 1, 3, 4, 6], [0, 1, 2, 3, 4, 6], [0, 1, 2, 3, 4, 5, 6]];
  return atx[Math.min(n, 7) - 1] ?? [];
}

const SOCKET = {
  AM4: { w: 4.0, h: 4.0, kind: 'pga' },
  AM5: { w: 4.0, h: 4.0, kind: 'lga' },
  LGA1700: { w: 3.75, h: 4.5, kind: 'lga' },
  LGA1851: { w: 3.75, h: 4.5, kind: 'lga' },
};

/** Socket size (cm) and kind ('pga' | 'lga') for a socket name; AM5 when unknown. */
export const socketSize = (socket) => SOCKET[socket] ?? SOCKET.AM5;

const rect = (u0, u1, v0, v1) => ({ u0, u1, v0, v1 });

/**
 * @param {object} board motherboard part (or null for a generic ATX board)
 * @returns layout in board-local cm
 */
export function boardLayout(board) {
  const ff = BOARD_DIMS[board?.formFactor] ? board.formFactor : 'ATX';
  const { w, h } = BOARD_DIMS[ff];
  const itx = ff === 'ITX';
  const socket = { ...(SOCKET[board?.socket] ?? SOCKET.AM5), u: itx ? 9.0 : 10.9, v: itx ? 6.8 : 9.4 };

  const ramCount = Math.max(1, Math.min(board?.memorySlots ?? (itx ? 2 : 4), 4));
  const ramPitch = ramCount === 4 ? 0.95 : 1.1;
  const ramU0 = itx ? 13.4 : 15.6;
  const ram = Array.from({ length: ramCount }, (_, i) => ({ u: ramU0 + i * ramPitch, v0: itx ? 1.0 : 1.8, v1: itx ? 15.1 : 15.9 }));

  const slots = Array.isArray(board?.pcieSlots) && board.pcieSlots.length ? board.pcieSlots : [{ size: 'x16', lanes: 16, gen: 4 }];
  const rows = slotPositions(ff, slots.length);
  const pcie = rows.map((k, i) => {
    const s = slots[i];
    return { k, v: slotRowV(ff, k), u0: SLOT_U0, len: SLOT_LEN[s.size] ?? SLOT_LEN.x16, size: s.size, lanes: s.lanes, gen: s.gen };
  });

  const chipset = itx ? rect(3.8, 12.2, 10.4, 13.6)
    : ff === 'mATX' ? rect(15.4, 22.8, 17.8, 23.4)
      : rect(15.4, 22.8, 22.6, 28.8);

  return {
    ff, w, h,
    io: itx ? rect(0, 3.2, 0.5, 15.0) : rect(0, 3.2, 0.6, 16.0),
    vrm: itx
      ? [rect(3.6, 12.4, 0.9, 3.2), rect(3.4, 5.4, 3.4, 9.6)]
      : [rect(4.0, 14.6, 1.2, 4.0), rect(3.4, 6.0, 4.4, 14.0)],
    socket,
    ram,
    pcie,
    chipset,
    atx24: itx ? rect(15.9, 16.9, 9.4, 14.6) : rect(w - 1.2, w - 0.2, 5.5, 10.7),
    eps: epsSockets(board?.cpuPower),
    sata: sataPorts(ff, w, h, board?.sataPorts ?? 4),
    headers: headerLayout(ff, w, h),
    m2: m2Positions(ff, board?.m2Slots ?? 1, pcie),
  };
}

// CPU power sockets along the top edge: the data's list (e.g. ["8-pin", "4-pin"]), else one
// 8-pin with known = false. Each: { u0, u1, v0, v1, pins, known }.
function epsSockets(list) {
  const known = Array.isArray(list) && list.length > 0;
  let u = 4.2;
  return (known ? list : ['8-pin']).map((kind) => {
    const pins = kind === '4-pin' ? 4 : 8;
    const s = { ...rect(u, u + (pins === 8 ? 2.0 : 1.05), 0.15, 1.05), pins, known };
    u = s.u1 + 0.3;
    return s;
  });
}

// SATA ports: right-angle ports on the front edge, two per stack (u/v = plug centre).
function sataPorts(ff, w, h, count) {
  const v0 = ff === 'ITX' ? 15.0 : h - 9.5;
  const stacks = Math.min(Math.ceil(count / 2), ff === 'ITX' ? 1 : 3);
  const out = [];
  for (let i = 0; i < stacks; i++) for (const dz of [0.25, 0.65]) if (out.length < count) out.push({ u: w - 0.55, v: v0 + i * 1.3 + 0.5, dz });
  return out;
}

// Headers (centre u, v; size along u and v). Fan and lighting headers keep their usual
// spots: CPU_FAN by the socket, pump/OPT at the top right, case fans, ARGB, audio, USB and
// the front-panel header along the bottom edge. Real boards differ in detail.
function headerLayout(ff, w, h) {
  const hd = (kind, u, v, du, dv) => ({ kind, u, v, du, dv });
  if (ff === 'ITX') {
    return [
      hd('cpuFan', 13.25, 0.68, 0.95, 0.55), hd('pump', 15.4, 0.68, 0.95, 0.55),
      hd('audio', 1.6, h - 0.5, 1.3, 0.55), hd('argb', 4.2, h - 0.5, 0.75, 0.55), hd('sysFan', 6.4, h - 0.5, 0.95, 0.55),
      hd('usb3', 9.6, h - 0.55, 2.0, 0.85), hd('fpanel', 13.4, h - 0.5, 1.3, 0.55), hd('usbc', w - 0.55, 7.6, 0.6, 1.1),
    ];
  }
  const bottom = h - 0.5;
  return [
    hd('cpuFan', 15.5, 0.68, 0.95, 0.55), hd('pump', w - 2.35, 0.68, 0.95, 0.55), hd('sysFan', 3.55, 0.5, 0.9, 0.5),
    hd('audio', 1.7, bottom, 1.3, 0.55), hd('argb', 4.5, bottom, 0.75, 0.55), hd('sysFan', 7.0, bottom, 0.95, 0.55),
    hd('argb', 9.4, bottom, 0.75, 0.55), hd('sysFan', 12.0, bottom, 0.95, 0.55), hd('sysFan', 16.2, bottom, 0.95, 0.55),
    hd('fpanel', w - 3.0, bottom, 1.3, 0.55),
    hd('usbc', w - 0.55, 11.7, 0.6, 1.1), hd('usb3', w - 0.6, 13.9, 0.85, 2.0),
  ];
}

// M.2 slot centres for a 2280 drive (8.0 x 2.2 cm, long side along u).
// Front side first: above the first PCIe slot, then in gaps between slots, then a
// column above the chipset. Anything beyond that goes on the back of the board.
function m2Positions(ff, count, pcie) {
  const out = [];
  if (ff === 'ITX') {
    out.push({ u: 8.0, v: 12.0, cover: 'chipset' });
  } else {
    out.push({ u: 9.0, v: 14.4, cover: 'own' });
    const rows = pcie.map((p) => p.v).sort((a, b) => a - b);
    for (let i = 0; i + 1 < rows.length; i++) {
      if (rows[i + 1] - rows[i] >= 2 * PCIE_PITCH - 0.01) out.push({ u: 9.0, v: (rows[i] + rows[i + 1]) / 2, cover: 'own' });
    }
    if (ff !== 'mATX') for (const v of [18.4, 21.0]) out.push({ u: 19.2, v, cover: 'own' });
  }
  const back = ff === 'ITX' ? [{ u: 8.0, v: 8.5 }, { u: 8.0, v: 4.8 }] : [{ u: 9.0, v: 9.0 }, { u: 9.0, v: 20.0 }, { u: 9.0, v: 24.0 }];
  for (const b of back) out.push({ ...b, cover: 'none', back: true });
  return out.slice(0, Math.max(0, count));
}

// Standoff positions (u, v) per form factor. Approximate to the ATX hole pattern.
export const STANDOFFS = {
  'E-ATX': [[0.64, 1.0], [15.9, 1.0], [31.8, 1.0], [0.64, 16.5], [15.9, 16.5], [31.8, 16.5], [0.64, 29.5], [15.9, 29.5], [31.8, 29.5]],
  ATX: [[0.64, 1.0], [15.9, 1.0], [23.4, 1.0], [0.64, 16.5], [15.9, 16.5], [23.4, 16.5], [0.64, 29.5], [15.9, 29.5], [23.4, 29.5]],
  mATX: [[0.64, 1.0], [15.9, 1.0], [23.4, 1.0], [0.64, 16.5], [15.9, 16.5], [23.4, 16.5], [0.64, 23.4], [15.9, 23.4], [23.4, 23.4]],
  ITX: [[1.0, 1.0], [15.9, 1.0], [1.0, 16.0], [15.9, 16.0]],
};
