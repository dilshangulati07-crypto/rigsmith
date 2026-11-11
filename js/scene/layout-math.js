// Constants and small vector/box helpers shared by the layout modules. Pure maths (no three.js).
// Axes (cm): +X = case front, +Y = up, +Z = side-panel (window) side.

export const WALL = 0.3;     // steel panel thickness
export const SIDE = 0.4;     // side panel (tempered glass) thickness
export const FOOT = 1.2;     // feet height under the case body
export const STANDOFF = 0.6; // board standoff height
export const PCB = 0.16;     // board thickness

export const X = [1, 0, 0];
export const Y = [0, 1, 0];
export const Z = [0, 0, 1];
export const neg = (a) => a.map((v) => -v || 0);
export const add = (a, b, k = 1) => a.map((v, i) => v + b[i] * k);
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const r2 = (v) => Math.round(v * 100) / 100;

/** World-space size of a box with local `size` [x,y,z] placed with basis ex, ey. */
export function worldExtent(size, ex, ey) {
  const ez = cross(ex, ey);
  return [0, 1, 2].map((a) => Math.abs(ex[a]) * size[0] + Math.abs(ey[a]) * size[1] + Math.abs(ez[a]) * size[2]);
}

// Basis with local +Z along `normal` (fans: the airflow side), local +Y as close to `up` as possible.
export function basisFromNormal(normal, up = Y) {
  const ex = cross(up, normal);
  return { ex, ey: cross(normal, ex) };
}

/** Axis-aligned box around a centre. */
export const boxOf = (p, ext) => ({ min: p.map((v, a) => v - ext[a] / 2), max: p.map((v, a) => v + ext[a] / 2) });
/** Axis-aligned box of a local box [x0..x1, y0..y1, z0..z1] under a placement. */
export function boxOfLocal(placement, lo, hi) {
  const { p, ex, ey } = placement;
  const ez = cross(ex, ey);
  const c = [0, 1, 2].map((a) => (lo[a] + hi[a]) / 2);
  const size = [0, 1, 2].map((a) => hi[a] - lo[a]);
  const centre = [0, 1, 2].map((a) => p[a] + ex[a] * c[0] + ey[a] * c[1] + ez[a] * c[2]);
  return boxOf(centre, worldExtent(size, ex, ey));
}
export const hits = (a, b, tol = 0.05) => [0, 1, 2].every((i) => a.min[i] < b.max[i] - tol && b.min[i] < a.max[i] - tol);

// Centre z of a `size` fan near `z`, kept inside the case width.
export function zFitIn(W, size, z) {
  const lo = -W / 2 + WALL + size / 2;
  const hi = W / 2 - SIDE - size / 2;
  return lo > hi ? (lo + hi) / 2 : clamp(z, lo, hi);
}

/** Inner box of the case shell. */
export const shellOf = (cl) => ({ min: [-cl.D / 2 + WALL, WALL, -cl.W / 2 + WALL], max: [cl.D / 2 - WALL, cl.H - WALL, cl.W / 2 - SIDE] });

// ---------------------------------------------------------------- board frame
// A board is placed by its frame: origin = rear-top corner of the PCB front face, U = world
// direction of board +u (away from the I/O edge), V = world direction of +v (away from the top
// edge). Standard towers: U = +X, V = -Y. Cases with the I/O facing down: U = +Y, V = +X.

/** World point of board coordinates (u, v) at height dz above the PCB front face. */
export const boardPoint = (f, u, v, dz = 0) => [0, 1, 2].map((a) => f.o[a] + f.U[a] * u + f.V[a] * v + Z[a] * dz);
/** Placement for a model whose local +X = U and local +Y = -V (local +Z = out of the board). */
export const boardBasis = (f) => ({ ex: f.U, ey: neg(f.V) });
