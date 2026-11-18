// Power rules: estimated peak draw vs PSU wattage, and GPU / CPU power plugs.
import { issue, unknown, known, ramModules, fanCount, plural } from './util.js?v=fe48996dc3';

export const PSU_HEADROOM = 1.3; // PSU should be rated 30% above the estimated peak draw

// Fixed allowances (W) for parts whose data has no power figure. Sources: typical
// figures from maker datasheets and reviews, rounded up.
const BOARD_W = { 'E-ATX': 60, ATX: 50, mATX: 40, ITX: 35 };
const RAM_W = { DDR4: 4, DDR5: 6 }; // per module; RGB adds 1 W
const DRIVE_W = { nvme: 8, sata: 4, hdd: 9 }; // PCIe 5 NVMe uses 12 W
const FAN_W = 3; // per fan; RGB adds 1 W
const PUMP_W = 6;
const MISC_W = 25; // USB devices, RGB controllers, conversion slack

// Estimated peak draw. Returns { watts, recommendedW, lines: [{label, watts}], unknown: [names] }.
// CPU uses maxPowerW (Intel max turbo power / AMD PPT), else tdp x 1.35.
// GPU uses total board power (tdp); null = unknown, left out and listed in `unknown`.
export function estimateDraw(build) {
  const lines = [];
  const missing = [];
  const add = (label, watts) => lines.push({ label, watts: Math.round(watts) });
  const { cpu, gpu, motherboard: board, ram, storage, fans, cooler } = build;

  if (cpu) add(cpu.name, cpu.maxPowerW ?? cpu.tdp * 1.35);
  if (gpu) {
    if (known(gpu.tdp)) add(gpu.name, gpu.tdp);
    else missing.push(gpu.name);
  }
  if (board) add('Motherboard', BOARD_W[board.formFactor] ?? 50);
  if (ram.length) add(`Memory (${plural(ramModules(ram), 'module')})`, ram.reduce((w, k) => w + ramModules([k]) * ((RAM_W[k.type] ?? 5) + (k.rgb ? 1 : 0)), 0));
  if (storage.length) add(`Storage (${plural(storage.length, 'drive')})`, storage.reduce((w, d) => w + (d.pcieGen === 5 ? 12 : DRIVE_W[d.type] ?? 6), 0));
  const coolerFans = cooler ? (cooler.fans ?? 1) : 0;
  const caseFans = fanCount(fans);
  if (coolerFans + caseFans) add(`Fans (${coolerFans + caseFans})`, coolerFans * FAN_W + fans.reduce((w, f) => w + fanCount([f]) * (FAN_W + (f.rgb ? 1 : 0)), 0));
  if (cooler?.type === 'aio') add('AIO pump', PUMP_W);
  if (lines.length) add('USB, RGB and other', MISC_W);

  const watts = lines.reduce((w, l) => w + l.watts, 0);
  return { watts, recommendedW: Math.ceil((watts * PSU_HEADROOM) / 50) * 50, lines, unknown: missing };
}

function wattage(build) {
  const { psu, gpu, cpu } = build;
  if (!psu || !(cpu || gpu)) return [];
  const out = [];
  const draw = estimateDraw(build);
  if (gpu && !known(gpu.tdp)) out.push(unknown('psu-wattage', gpu, 'the board power', [psu], 'The wattage estimate leaves the card out.'));

  const need = Math.round(draw.watts * PSU_HEADROOM);
  if (psu.wattage < draw.watts) {
    out.push(issue('error', 'psu-wattage', [psu, cpu, gpu],
      `Estimated peak draw is ${draw.watts} W; ${psu.name} is rated ${psu.wattage} W.`,
      `Pick a PSU of at least ${draw.recommendedW} W.`));
  } else if (psu.wattage < need) {
    out.push(issue('warn', 'psu-headroom', [psu, cpu, gpu],
      `${psu.name} (${psu.wattage} W) covers the estimated ${draw.watts} W peak but leaves less than 30% headroom (${need} W).`,
      `A ${draw.recommendedW} W unit runs cooler and quieter and handles load spikes.`));
  }
  if (gpu && known(gpu.recommendedPSU) && psu.wattage < gpu.recommendedPSU && psu.wattage >= draw.watts) {
    out.push(issue('warn', 'psu-gpu-recommendation', [psu, gpu],
      `The maker of ${gpu.name} recommends a PSU of at least ${gpu.recommendedPSU} W; ${psu.name} is ${psu.wattage} W.`,
      `Pick a PSU of ${gpu.recommendedPSU} W or more.`));
  }
  if (gpu && known(gpu.tdp) && gpu.tdp >= 300 && known(psu.atxVersion) && !psu.atxVersion.startsWith('3')) {
    out.push(issue('info', 'psu-atx3', [psu, gpu],
      `${gpu.name} draws ${gpu.tdp} W with short spikes above that; ${psu.name} is ATX ${psu.atxVersion}. ATX 3.x units are specified for those spikes.`,
      null));
  }
  return out;
}

// One 8-pin PCIe plug carries 150 W. Cards with a 16-pin socket ship with an adapter
// that needs one 8-pin plug per 150 W of board power (2 to 4 plugs).
export const adapterPlugs = (gpu) => Math.min(4, Math.max(2, Math.ceil(gpu.tdp / 150)));

function gpuConnectors({ gpu, psu }) {
  if (!gpu || !psu) return [];
  if (!known(gpu.powerConnectors)) return [unknown('gpu-power', gpu, 'the power connectors', [psu])];
  const c = psu.connectors ?? {};
  const need16 = gpu.powerConnectors.filter((x) => x === '16-pin').length;
  const need8 = gpu.powerConnectors.length - need16; // 6+2 plugs also fill 6-pin sockets
  const out = [];

  if (need8) {
    if (!known(c.pcie8)) out.push(unknown('gpu-power', psu, 'the number of PCIe 8-pin plugs', [gpu]));
    else if (c.pcie8 < need8) {
      out.push(issue('error', 'gpu-power', [gpu, psu],
        `${gpu.name} needs ${plural(need8, 'PCIe 8-pin plug')} (${gpu.powerConnectors.join(' + ')}); ${psu.name} has ${c.pcie8}.`,
        `Pick a PSU with ${need8} or more PCIe 8-pin plugs.`));
    }
  }
  if (need16) {
    if (known(c.pcie16) && c.pcie16 >= need16) return out;
    // No native cable (or not stated): fall back to the adapter that comes with the card.
    const plugs = known(gpu.tdp) ? adapterPlugs(gpu) * need16 : null;
    if (known(plugs) && known(c.pcie8) && c.pcie8 >= plugs) {
      out.push(issue('info', 'gpu-power', [gpu, psu],
        `${psu.name} ${known(c.pcie16) ? 'has no' : "isn't confirmed to have a"} native 16-pin cable; ${gpu.name} can run from its included adapter on ${plural(plugs, 'PCIe 8-pin plug')}.`,
        'A PSU with a native 12V-2x6 cable is tidier.'));
    } else if (!known(c.pcie16)) {
      out.push(unknown('gpu-power', psu, 'a native 16-pin (12V-2x6) cable', [gpu]));
    } else if (!known(plugs)) {
      out.push(unknown('gpu-power', gpu, 'the board power', [psu], 'Without it the 8-pin plug count for the 16-pin adapter is unknown.'));
    } else if (!known(c.pcie8)) {
      out.push(unknown('gpu-power', psu, 'the number of PCIe 8-pin plugs for the 16-pin adapter', [gpu]));
    } else {
      out.push(issue('error', 'gpu-power', [gpu, psu],
        `${gpu.name} has a 16-pin socket. ${psu.name} has no 16-pin cable and ${c.pcie8} PCIe 8-pin plugs; the adapter needs about ${plugs}.`,
        'Pick a PSU with a native 16-pin (12V-2x6) cable.'));
    }
  }
  return out;
}

function cpuConnectors({ cpu, psu }) {
  if (!cpu || !psu) return [];
  const eps = psu.connectors?.eps8;
  if (!known(eps)) return [unknown('cpu-power', psu, 'the number of CPU (EPS 8-pin) plugs', [cpu])];
  if (eps < 1) return [issue('error', 'cpu-power', [psu, cpu], `${psu.name} has no CPU 8-pin plug.`, 'Pick a PSU with at least one EPS 8-pin.')];
  if (eps === 1 && (cpu.maxPowerW ?? 0) > 200) {
    return [issue('info', 'cpu-power', [psu, cpu],
      `${psu.name} has one CPU 8-pin plug. Boards built for ${cpu.maxPowerW} W CPUs often have a second (8+8 or 8+4); one is enough to boot, the second helps under heavy load.`, null)];
  }
  return [];
}

export const rules = [wattage, gpuConnectors, cpuConnectors];
