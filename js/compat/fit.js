// Physical fit inside the case: board size, graphics card length and thickness,
// PSU size, fan mounts.
import { issue, unknown, known, gpuSlotWidth, gpuClearance, fanCount, plural } from './util.js?v=fe48996dc3';
import { radiatorPositions } from './cooling.js?v=fe48996dc3';

// A front radiator plus its fans takes about this much GPU length (27 mm radiator,
// 25 mm fans, a little slack). Case limits are printed without one.
const FRONT_RADIATOR_MM = 60;

function boardInCase({ motherboard: board, case: pcCase }) {
  if (!board || !pcCase) return [];
  if (!known(pcCase.formFactorsSupported)) return [unknown('board-case', pcCase, 'which board sizes fit', [board])];
  if (pcCase.formFactorsSupported.includes(board.formFactor)) return [];
  return [issue('error', 'board-case', [board, pcCase],
    `${board.name} is ${board.formFactor}; ${pcCase.name} takes ${pcCase.formFactorsSupported.join(', ')}.`,
    `Pick a ${pcCase.formFactorsSupported.join(' or ')} board, or a case that takes ${board.formFactor}.`)];
}

function gpuLength({ gpu, case: pcCase, cooler }) {
  if (!gpu || !pcCase) return [];
  if (!known(gpu.lengthMM)) return [unknown('gpu-length', gpu, 'the card length', [pcCase])];
  const { limit, vertical } = gpuClearance(pcCase);
  if (!known(limit)) return [unknown('gpu-length', pcCase, 'the graphics card clearance', [gpu])];

  const out = [];
  if (gpu.lengthMM > limit) {
    return [issue('error', 'gpu-length', [gpu, pcCase],
      `${gpu.name} is ${gpu.lengthMM} mm long; ${pcCase.name} fits cards up to ${limit} mm${vertical ? ' (vertical mount)' : ''}.`,
      `Pick a card of ${limit} mm or shorter, or a larger case.`)];
  }
  if (vertical) {
    const w = gpuSlotWidth(gpu);
    out.push(issue('info', 'gpu-vertical', [gpu, pcCase],
      `${pcCase.name} mounts the graphics card vertically on a riser along its ${limit} mm height, so ${gpu.name} (${gpu.lengthMM} mm) fits.`
        + (w && w > 2 ? ` Can't confirm the vertical mount clears a ${w}-slot card.` : ''),
      'Check the riser cable is included and matches the card\'s PCIe generation.'));
  } else if (cooler?.type === 'aio' && known(cooler.radiatorSizeMM) && known(pcCase.radiatorSupport)) {
    const { fits } = radiatorPositions(pcCase, cooler.radiatorSizeMM);
    if (fits.length === 1 && fits[0] === 'front' && gpu.lengthMM > limit - FRONT_RADIATOR_MM) {
      out.push(issue('warn', 'gpu-length-radiator', [gpu, cooler, pcCase],
        `The ${cooler.radiatorSizeMM} mm radiator only fits the front of ${pcCase.name}, which takes about ${FRONT_RADIATOR_MM} mm from the ${limit} mm GPU clearance; ${gpu.name} is ${gpu.lengthMM} mm.`,
        'Check the maker\'s clearance with a front radiator, or pick a shorter card or a smaller radiator that fits the top.'));
    }
  }
  if (!out.length && limit - gpu.lengthMM < 10) {
    out.push(issue('info', 'gpu-length', [gpu, pcCase], `${gpu.name} fits ${pcCase.name} with ${limit - gpu.lengthMM} mm to spare.`, null));
  }
  return out;
}

// Case slot counts are optional data (`maxGPUSlots`); without them only ITX cases,
// which often limit card thickness, get a note.
function gpuThickness({ gpu, motherboard: board, case: pcCase }) {
  if (!gpu) return [];
  const out = [];
  const w = gpuSlotWidth(gpu);
  const vertical = pcCase ? gpuClearance(pcCase).vertical : false;
  if (!known(w)) {
    if (pcCase || board) out.push(unknown('gpu-slots', gpu, 'the card thickness (slot width)', [pcCase, board]));
  } else if (pcCase && !vertical) {
    if (known(pcCase.maxGPUSlots)) {
      if (w > pcCase.maxGPUSlots) {
        out.push(issue('error', 'gpu-slots', [gpu, pcCase],
          `${gpu.name} is ${w} slots thick; ${pcCase.name} takes up to ${pcCase.maxGPUSlots}.`,
          `Pick a card of ${pcCase.maxGPUSlots} slots or thinner.`));
      }
    } else if (pcCase.caseType === 'itx' && w > 2) {
      out.push(issue('info', 'gpu-slots', [gpu, pcCase],
        `Can't confirm ${pcCase.name} takes a ${w}-slot card: the case's slot count isn't in our data yet.`,
        "Check the maker's maximum GPU thickness before buying."));
    }
  }

  if (board) {
    if (!known(board.pcieSlots)) {
      out.push(unknown('gpu-board-slot', board, 'the PCIe slot layout', [gpu]));
    } else if (!board.pcieSlots.some((s) => s.size === 'x16')) {
      out.push(issue('error', 'gpu-board-slot', [gpu, board], `${board.name} has no x16 slot for a graphics card.`, 'Pick a board with a full-length x16 slot.'));
    } else if (known(w) && w > 2 && !vertical && board.pcieSlots.length > 1) {
      const covered = Math.ceil(w) - 1;
      out.push(issue('info', 'gpu-board-slot', [gpu, board],
        `${gpu.name} is ${w} slots thick and covers the ${plural(covered, 'slot position')} under the main x16 slot on ${board.name}.`,
        'Only matters if you plan to add other expansion cards.'));
    }
  }
  return out;
}

function psuInCase({ psu, case: pcCase }) {
  if (!psu || !pcCase) return [];
  if (!known(pcCase.psuFormFactors)) return [unknown('psu-form-factor', pcCase, 'which PSU sizes fit', [psu])];
  if (!known(psu.formFactor)) return [unknown('psu-form-factor', psu, 'the PSU size', [pcCase])];
  if (pcCase.psuFormFactors.includes(psu.formFactor)) return [];
  if (psu.formFactor.startsWith('SFX') && pcCase.psuFormFactors.includes('ATX')) {
    return [issue('info', 'psu-form-factor', [psu, pcCase],
      `${psu.name} is ${psu.formFactor}; ${pcCase.name} has an ATX PSU mount, so it needs an SFX-to-ATX bracket.`,
      'Many SFX units include the bracket; check the box contents.')];
  }
  return [issue('error', 'psu-form-factor', [psu, pcCase],
    `${psu.name} is ${psu.formFactor}; ${pcCase.name} takes ${pcCase.psuFormFactors.join(', ')} power supplies.`,
    `Pick a ${pcCase.psuFormFactors.join(' or ')} PSU.`)];
}

// Each position mounts several fans of one size ("2x 120/140" = two of either), so a
// size's capacity is the sum of that size over positions, and the total is capped by
// the larger option per position.
function fanMounts({ fans, cooler, case: pcCase }) {
  const radFans = cooler?.type === 'aio' && known(cooler.fans) && known(cooler.fanSizeMM) ? cooler.fans : 0;
  if (!pcCase || !fans.length) return [];
  if (!known(pcCase.fanMounts)) return [unknown('fan-mounts', pcCase, 'the fan mounts', fans)];

  const need = {};
  for (const f of fans) need[f.sizeMM] = (need[f.sizeMM] ?? 0) + fanCount([f]);
  if (radFans) need[cooler.fanSizeMM] = (need[cooler.fanSizeMM] ?? 0) + radFans;

  const positions = Object.values(pcCase.fanMounts);
  const cap = (size) => positions.reduce((n, p) => n + (p[size] ?? 0), 0);
  const total = positions.reduce((n, p) => n + Math.max(...Object.values(p)), 0);
  const needTotal = Object.values(need).reduce((a, b) => a + b, 0);

  const short = Object.entries(need).filter(([size, n]) => n > cap(size));
  if (!short.length && needTotal <= total) return [];
  const what = short.length
    ? short.map(([size, n]) => `${n} x ${size} mm fans but only ${cap(size)} mounts of that size`).join('; ')
    : `${needTotal} fans but only ${total} fan mounts`;
  return [issue('warn', 'fan-mounts', [...fans, radFans ? cooler : null, pcCase],
    `${pcCase.name}: ${what}${radFans ? ' (radiator fans included)' : ''}.`,
    'Drop a fan pack, or check whether the case comes with fans already fitted.')];
}

export const rules = [boardInCase, gpuLength, gpuThickness, psuInCase, fanMounts];
