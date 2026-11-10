// Performance ESTIMATE. A transparent heuristic, not a benchmark. Full write-up in
// docs/perf-model.md; keep the two in sync when changing a constant.
//
// estimatePerformance(build) -> {
//   label: 'Estimate', scores: { gaming1080, gaming1440, gaming4k, video, ai, general } (0-100 or null),
//   components: { cpuST, cpuMT, cpuGaming, gpu, ram, storage }, bottleneck: { primary, hints[] },
//   assumptions: [strings], missing: [strings] }
//
// 100 = the strongest parts in the catalogue at that workload, not "perfect".

export const PERF_LABEL = 'Estimate';
export const WORKLOADS = Object.freeze([
  { id: 'gaming1080', label: '1080p gaming' },
  { id: 'gaming1440', label: '1440p gaming' },
  { id: 'gaming4k', label: '4K gaming' },
  { id: 'video', label: 'Video editing' },
  { id: 'ai', label: 'AI / compute' },
  { id: 'general', label: 'General use' },
]);

// ---------------------------------------------------------------- CPU
// Per-clock speed by architecture, Zen 3 = 1.00. Rounded from public review averages.
const IPC = {
  'Zen 3': 1.0, 'Zen 4': 1.13, 'Zen 5': 1.2,
  'Alder Lake': 1.05, 'Raptor Lake': 1.09, 'Raptor Lake Refresh': 1.09, 'Arrow Lake': 1.12,
};
// Games only: 3D V-Cache adds ~20%; Arrow Lake's memory latency costs ~7%.
const GAMING_ADJ = { x3d: 1.2, 'Arrow Lake': 0.93 };
const ST_REF = 6.9; // boost GHz x IPC that scores 100 (Ryzen 9 9950X ~ 6.84)
const MT_REF = 142; // effective cores x GHz x IPC that scores 100 (Ryzen 9 9950X)

// Effective cores: an SMT core counts 1.3, an Intel E-core 0.55 (12th-14th gen).
// Hybrid CPUs list threads = 2P + E, so P = threads - cores. Arrow Lake has no
// Hyper-Threading and its P/E split isn't in the data: 0.85 per core.
export function effectiveCores(cpu) {
  const { cores, threads } = cpu;
  if (threads === cores * 2) return cores * 1.3;
  if (threads > cores) {
    const p = threads - cores;
    return p * 1.3 + (cores - p) * 0.55;
  }
  return cores * (cpu.architecture === 'Arrow Lake' ? 0.85 : 1);
}

export function cpuScores(cpu) {
  const ipc = IPC[cpu.architecture] ?? 1.0;
  const st = (cpu.boostClockGHz * ipc / ST_REF) * 100;
  const mt = (effectiveCores(cpu) * cpu.boostClockGHz * ipc / MT_REF) * 100;
  const adj = (/X3D/.test(cpu.name) ? GAMING_ADJ.x3d : 1) * (GAMING_ADJ[cpu.architecture] ?? 1);
  const coreFactor = cpu.cores < 6 ? 0.85 : 1; // 4-core CPUs stutter in newer games
  return { st, mt, gaming: st * adj * coreFactor };
}

// ---------------------------------------------------------------- GPU
// Relative 1440p raster performance, RTX 4090 = 100. Rounded from public review
// averages (+/-10%). Keyed by the `chip` field in gpu.json.
export const GPU_INDEX = {
  'RTX 5090': 127, 'RTX 4090': 100, 'RTX 5080': 84, 'RTX 4080 SUPER': 80, 'RX 7900 XTX': 81,
  'RX 9070 XT': 74, 'RTX 5070 Ti': 73, 'RX 7900 XT': 70, 'RTX 4070 Ti SUPER': 68, 'RX 9070': 66,
  'RTX 5070': 62, 'RTX 4070 SUPER': 60, 'RX 7800 XT': 57, 'RTX 4070': 52, 'RX 7700 XT': 49,
  'RTX 5060 Ti': 45, 'RX 9060 XT 16GB': 44, 'RTX 4060 Ti': 41, 'RTX 5060': 38, 'Arc B580': 37,
  'RX 7600 XT': 35, 'RTX 4060': 33, 'RX 7600': 33, 'Arc A770': 32, 'Arc A750': 29,
  'RTX 3060': 28, 'RX 6600': 26, 'RTX 3050 6GB': 15,
};
// Integrated graphics on the same scale, keyed by igpuName.
const IGPU_INDEX = {
  'AMD Radeon 780M': 9, 'AMD Radeon 760M': 7, 'Intel Graphics': 6, 'AMD Radeon Graphics (7 CU)': 4.5,
  'Intel UHD Graphics 770': 3, 'Intel UHD Graphics 730': 2.5, 'AMD Radeon Graphics (2 CU)': 2.5,
};
// Fallback when a chip isn't in the table: the part's tier.
const TIER_GPU = { budget: 25, mid: 45, high: 65, flagship: 95 };
const GPU_REF = 127; // best card in the catalogue
// Compute software support (CUDA vs ROCm vs oneAPI) for AI workloads.
const AI_VENDOR = { NVIDIA: 1.0, AMD: 0.7, Intel: 0.6 };

function gpuIndex(gpu, cpu) {
  if (gpu) return { value: GPU_INDEX[gpu.chip] ?? TIER_GPU[gpu.tier] ?? 30, fromTier: !(gpu.chip in GPU_INDEX), igpu: false };
  if (cpu?.igpu) return { value: IGPU_INDEX[cpu.igpuName] ?? 2.5, fromTier: false, igpu: true };
  return null;
}

// ---------------------------------------------------------------- RAM and storage
// Capacity: 4 GB = 0, 16 GB = 50, 64 GB = 100 (log2 scale, capped).
const ramCapacityScore = (gb) => Math.max(0, Math.min(100, (Math.log2(gb / 4) / 4) * 100));
// Games: 8 GB stutters, 16 GB is fine, 32 GB+ is full marks. Single channel -10%.
function ramGamingFactor(gb, modules, type, speed) {
  const cap = gb < 16 ? 0.8 : gb < 32 ? 0.97 : 1;
  const channel = modules === 1 ? 0.9 : 1;
  const slow = (type === 'DDR4' && speed < 3200) || (type === 'DDR5' && speed < 5600) ? 0.98 : 1;
  return cap * channel * slow;
}
// Sequential read on a log scale: 100 MB/s = 0, 14,000 MB/s = 100.
const storageScore = (readMBs) => Math.max(0, Math.min(100, (Math.log10(readMBs / 100) / Math.log10(140)) * 100));

// ---------------------------------------------------------------- gaming model
// Each side has a frame-rate "capacity". The CPU's doesn't change with resolution; the
// GPU's falls as pixels rise. Delivered = soft minimum of the two (k = 4), so the
// slower side dominates, as in real games.
const CPU_CAP = 1.3;
const RES = {
  gaming1080: { scale: 1.55, label: '1080p', vram: () => 1 },
  gaming1440: { scale: 1.0, label: '1440p', vram: (gb) => (gb < 10 ? 0.92 : 1) },
  gaming4k: { scale: 0.52, label: '4K', vram: (gb) => (gb < 10 ? 0.75 : gb < 12 ? 0.85 : 1) },
};
const K = 4;
const softMin = (a, b) => (a ** -K + b ** -K) ** (-1 / K);
// Reference = best CPU (Ryzen 7 9800X3D, gaming ~108) with the best GPU.
const REF_CPU_GAMING = 108;
const refDelivered = (res) => softMin(REF_CPU_GAMING * CPU_CAP, GPU_REF * RES[res].scale);

const clamp = (v) => Math.round(Math.max(0, Math.min(100, v)));

export function estimatePerformance(build) {
  const { cpu, gpu } = build;
  const ram = build.ram ?? [];
  const storage = build.storage ?? [];
  const assumptions = [];
  const missing = [];
  const empty = { gaming1080: null, gaming1440: null, gaming4k: null, video: null, ai: null, general: null };

  if (!cpu) {
    return { label: PERF_LABEL, scores: empty, components: null, bottleneck: { primary: null, hints: [] }, assumptions, missing: ['CPU'] };
  }
  const c = cpuScores(cpu);
  const g = gpuIndex(gpu, cpu);
  if (!g) missing.push('graphics (no GPU and the CPU has no integrated graphics)');
  if (g?.fromTier) assumptions.push(`${gpu.name}: chip not in the performance table, estimated from its tier.`);

  let ramGB = ram.reduce((n, k) => n + k.capacityGB, 0);
  let modules = ram.reduce((n, k) => n + (k.modules ?? 1), 0);
  let ramType = ram[0]?.type;
  let ramSpeed = ram.length ? Math.min(...ram.map((k) => k.speedMTs)) : null;
  if (!ram.length) {
    assumptions.push('No memory chosen: assumed 16 GB dual channel at rated speed.');
    ramGB = 16; modules = 2; ramType = cpu.memoryType[0]; ramSpeed = ramType === 'DDR5' ? 6000 : 3200;
  }
  let fastest = storage.length ? Math.max(...storage.map((d) => d.readMBs ?? 500)) : null;
  if (!storage.length) {
    assumptions.push('No storage chosen: assumed a SATA SSD.');
    fastest = 550;
  }

  const ramCap = ramCapacityScore(ramGB);
  const store = storageScore(fastest);
  const gpuRel = g ? (g.value / GPU_REF) * 100 : 0;
  const vram = gpu?.vramGB ?? 0;
  const ramGame = ramGamingFactor(ramGB, modules, ramType, ramSpeed);

  const scores = { ...empty };
  const caps = {};
  for (const [id, r] of Object.entries(RES)) {
    if (!g) continue;
    const cpuCap = c.gaming * CPU_CAP;
    const gpuCap = g.value * r.scale * (g.igpu ? 1 : r.vram(vram));
    caps[id] = { cpuCap, gpuCap };
    scores[id] = clamp((softMin(cpuCap, gpuCap) * ramGame / refDelivered(id)) * 100);
  }
  // Workstation mixes (weights sum to 1).
  scores.video = clamp(0.40 * c.mt + 0.10 * c.st + 0.20 * gpuRel + 0.15 * ramCap + 0.15 * store);
  const aiGpu = gpu ? gpuRel * (AI_VENDOR[gpu.chipMaker] ?? 0.6) : gpuRel * 0.3;
  const vramScore = Math.min(100, (vram / 32) * 100);
  scores.ai = clamp(0.45 * aiGpu + 0.30 * vramScore + 0.10 * ramCap + 0.10 * c.mt + 0.05 * store);
  scores.general = clamp(0.45 * c.st + 0.15 * c.mt + 0.20 * store + 0.20 * ramCap);

  return {
    label: PERF_LABEL,
    scores,
    components: { cpuST: clamp(c.st), cpuMT: clamp(c.mt), cpuGaming: clamp(c.gaming), gpu: clamp(gpuRel), ram: clamp(ramCap), storage: clamp(store) },
    bottleneck: bottleneck(build, caps, { ramGB, modules, fastest }),
    assumptions,
    missing,
  };
}

// ---------------------------------------------------------------- bottleneck hint
// ratio = CPU capacity / GPU capacity at a resolution.
//   < 0.85 at any resolution  -> CPU-limited there
//   > 2.5 at 1080p            -> GPU is the clear weak link
//   < 1.2 at 1080p            -> well matched
//   otherwise                 -> GPU-bound everywhere (the normal, healthy case)
function bottleneck({ cpu, gpu, storage = [] }, caps, { ramGB, modules, fastest }) {
  const hints = [];
  const gpuName = gpu ? gpu.name : 'the integrated graphics';
  const Gpu = gpu ? gpu.name : 'The integrated graphics';
  const limited = Object.entries(caps).filter(([, x]) => x.cpuCap < x.gpuCap * 0.85).map(([id]) => RES[id].label);
  const r1080 = caps.gaming1080 ? caps.gaming1080.cpuCap / caps.gaming1080.gpuCap : null;
  if (limited.length) {
    const topCpu = cpuScores(cpu).gaming >= REF_CPU_GAMING * 0.95;
    hints.push(topCpu
      ? `At ${limited.join(' and ')} even ${cpu.name} can't keep ${gpuName} fully busy; normal for a flagship card, which is meant for higher resolutions.`
      : `${cpu.name} limits ${gpuName} at ${limited.join(' and ')}: a faster CPU would raise frame rates there.`);
  } else if (r1080 > 2.5) {
    hints.push(`${Gpu} is the limit in games; ${cpu.name} could feed a much faster card.`);
  } else if (r1080 !== null && r1080 < 1.2) {
    hints.push('CPU and GPU are well matched: close at 1080p, and the GPU sets the frame rate at 1440p and 4K.');
  } else if (r1080 !== null) {
    hints.push(`No CPU bottleneck: ${gpuName} sets the frame rate at every resolution, which is the balance you want.`);
  }
  if (ramGB < 16) hints.push(`${ramGB} GB of memory is short for current games and browsers; 16 GB is the practical minimum.`);
  if (modules === 1) hints.push('One memory module runs single channel; a 2-module kit is faster.');
  if (storage.length && fastest < 400) hints.push('The fastest drive is a hard disk; use an SSD for the operating system.');
  return { primary: hints[0] ?? null, hints };
}
