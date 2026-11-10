// CPU cooler rules: socket, tower height, AIO radiator mounts, cooling capacity.
import { issue, unknown, known, list } from './util.js';

// Radiators come in 120 mm and 140 mm fan families; a mount for one family
// does not imply the other (a 360 mount may not take a 280).
const family = (mm) => (mm % 140 === 0 ? 140 : 120);

// Where a radiator of `sizeMM` can go: { fits: [positions], maybe: [positions] }.
// `maybe` = the page gives only a maximum in the other fan family.
export function radiatorPositions(pcCase, sizeMM) {
  const fits = [];
  const maybe = [];
  for (const r of pcCase.radiatorSupport ?? []) {
    if (r.sizesMM) {
      if (r.sizesMM.includes(sizeMM)) fits.push(r.position);
    } else if (r.maxMM >= sizeMM) {
      (family(r.maxMM) === family(sizeMM) ? fits : maybe).push(r.position);
    }
  }
  return { fits, maybe };
}

function socket({ cpu, cooler }) {
  if (!cpu || !cooler || cooler.socketsSupported.includes(cpu.socket)) return [];
  return [issue('error', 'cooler-socket', [cooler, cpu],
    `${cooler.name} has no mounting kit for ${cpu.socket}.`,
    `Pick a cooler that lists ${cpu.socket}, or ask the maker for a mounting kit.`)];
}

function towerHeight({ cooler, case: pcCase }) {
  if (!cooler || cooler.type !== 'air' || !pcCase) return [];
  if (!known(cooler.heightMM)) return [unknown('cooler-height', cooler, 'the cooler height', [pcCase])];
  if (!known(pcCase.maxCoolerHeightMM)) return [unknown('cooler-height', pcCase, 'the CPU cooler clearance', [cooler])];
  const spare = pcCase.maxCoolerHeightMM - cooler.heightMM;
  if (spare < 0) {
    return [issue('error', 'cooler-height', [cooler, pcCase],
      `${cooler.name} is ${cooler.heightMM} mm tall; ${pcCase.name} fits coolers up to ${pcCase.maxCoolerHeightMM} mm.`,
      `Pick an air cooler of ${pcCase.maxCoolerHeightMM} mm or less, or an AIO.`)];
  }
  if (spare < 3) {
    return [issue('info', 'cooler-height', [cooler, pcCase],
      `${cooler.name} fits ${pcCase.name} with ${spare} mm to spare.`, null)];
  }
  return [];
}

function radiator({ cooler, case: pcCase }) {
  if (!cooler || cooler.type !== 'aio' || !pcCase) return [];
  if (!known(cooler.radiatorSizeMM)) return [unknown('radiator-fit', cooler, 'the radiator size', [pcCase])];
  if (!known(pcCase.radiatorSupport)) return [unknown('radiator-fit', pcCase, 'radiator mounts', [cooler])];
  const size = cooler.radiatorSizeMM;
  const { fits, maybe } = radiatorPositions(pcCase, size);
  if (fits.length) return [];
  if (maybe.length) {
    return [issue('info', 'radiator-fit', [cooler, pcCase],
      `${pcCase.name} gives only a maximum radiator size at the ${list(maybe)}; can't confirm a ${size} mm radiator fits there.`,
      "Check the maker's radiator list before buying.")];
  }
  return [issue('error', 'radiator-fit', [cooler, pcCase],
    `${pcCase.name} has no mount for a ${size} mm radiator.`,
    `Pick an AIO the case supports (${[...new Set(pcCase.radiatorSupport.map((r) => `${r.maxMM} mm ${r.position}`))].join(', ') || 'none'}) or an air cooler.`)];
}

// tdpRating null means the maker publishes none, so there is nothing to compare.
function capacity({ cpu, cooler }) {
  if (!cpu || !cooler) return [];
  const peak = cpu.maxPowerW ?? cpu.tdp;
  if (known(cooler.tdpRating)) {
    if (cooler.tdpRating < cpu.tdp) {
      return [issue('warn', 'cooler-capacity', [cooler, cpu],
        `${cooler.name} is rated for ${cooler.tdpRating} W; ${cpu.name} is a ${cpu.tdp} W CPU.`,
        'Pick a cooler rated at or above the CPU power.')];
    }
    if (cooler.tdpRating < peak) {
      return [issue('info', 'cooler-capacity', [cooler, cpu],
        `${cpu.name} can draw ${peak} W at full boost; ${cooler.name} is rated for ${cooler.tdpRating} W, so it may lower clocks a little under long all-core loads.`, null)];
    }
    return [];
  }
  // No published rating: flag only the obvious mismatch of a low-profile cooler on a hot CPU.
  if (cooler.type === 'air' && known(cooler.heightMM) && cooler.heightMM < 80 && peak > 150) {
    return [issue('warn', 'cooler-capacity', [cooler, cpu],
      `${cooler.name} is a low-profile cooler; ${cpu.name} can draw ${peak} W and will throttle under load.`,
      'Use a tower cooler or AIO if the case allows, or a lower-power CPU.')];
  }
  return [];
}

function boxedCooler({ cpu, cooler }) {
  if (!cpu || cooler) return [];
  if (cpu.coolerIncluded === true) {
    return [issue('info', 'boxed-cooler', [cpu], `No cooler chosen: ${cpu.name} ships with a stock cooler in the retail box.`, 'An aftermarket cooler runs quieter and cooler.')];
  }
  if (!known(cpu.coolerIncluded)) return [unknown('boxed-cooler', cpu, 'whether a cooler is in the box')];
  return []; // reported as a missing part by essentials.js
}

export const rules = [socket, towerHeight, radiator, capacity, boxedCooler];
