// CPU, motherboard and memory rules.
import { issue, unknown, known, ramModules, ramCapacity, plural } from './util.js?v=4fbe99bdc0';

// CPU generations each chipset runs on its launch BIOS. Anything else needs a BIOS update,
// which fails to boot on an old board without BIOS Flashback.
const LAUNCH_BIOS = {
  A520: [], B450: [], B550: [], X570: [], // AM4 boards launched before Ryzen 5000
  A620: ['Ryzen 7000'], B650: ['Ryzen 7000'], B650E: ['Ryzen 7000'], X670: ['Ryzen 7000'], X670E: ['Ryzen 7000'],
  B850: ['Ryzen 7000', 'Ryzen 8000G', 'Ryzen 9000'],
  X870: ['Ryzen 7000', 'Ryzen 8000G', 'Ryzen 9000'],
  X870E: ['Ryzen 7000', 'Ryzen 8000G', 'Ryzen 9000'],
  H610: ['Core 12th Gen'], B660: ['Core 12th Gen'], H670: ['Core 12th Gen'], Z690: ['Core 12th Gen'],
  B760: ['Core 12th Gen', 'Core 13th Gen'], H770: ['Core 12th Gen', 'Core 13th Gen'], Z790: ['Core 12th Gen', 'Core 13th Gen'],
  H810: ['Core Ultra 200S'], B860: ['Core Ultra 200S'], Z890: ['Core Ultra 200S'],
};
// Entry chipsets with basic power delivery and no CPU overclocking.
const ENTRY_CHIPSETS = ['A520', 'A620', 'H610', 'H810'];
const isUnlockedIntel = (cpu) => cpu.brand === 'Intel' && /\d+K[FS]?\b/.test(cpu.name);

function cpuBoard({ cpu, motherboard: board }) {
  if (!cpu || !board) return [];
  if (cpu.socket !== board.socket) {
    return [issue('error', 'cpu-socket', [cpu, board],
      `${cpu.name} uses socket ${cpu.socket}; ${board.name} has ${board.socket}.`,
      `Pick a ${cpu.socket} motherboard or a ${board.socket} CPU.`)];
  }
  const out = [];
  if (!cpu.memoryType.includes(board.memoryType)) {
    out.push(issue('error', 'cpu-memory', [cpu, board],
      `${cpu.name} supports ${cpu.memoryType.join('/')}, but ${board.name} is a ${board.memoryType} board.`,
      `Pick a ${cpu.memoryType.join(' or ')} motherboard.`));
  }
  const native = LAUNCH_BIOS[board.chipset];
  if (native && !native.includes(cpu.generation)) {
    out.push(issue('warn', 'bios-update', [cpu, board],
      `${board.chipset} boards launched before ${cpu.generation} CPUs. Older stock needs a BIOS update before it boots the ${cpu.name}.`,
      'Check the BIOS version on the box, or pick a board with BIOS Flashback so you can update without a CPU.'));
  }
  if (isUnlockedIntel(cpu) && !board.chipset.startsWith('Z')) {
    out.push(issue('info', 'chipset-oc', [cpu, board],
      `${board.chipset} boards can't overclock the unlocked ${cpu.name}; it runs at stock settings.`,
      'Fine for most people. For overclocking, pick a Z-series board.'));
  }
  if (ENTRY_CHIPSETS.includes(board.chipset) && (cpu.maxPowerW ?? cpu.tdp) >= 150) {
    out.push(issue('info', 'chipset-power', [cpu, board],
      `${board.name} is an entry ${board.chipset} board; under long all-core loads a ${cpu.maxPowerW ?? cpu.tdp} W CPU may run below its boost clocks.`,
      'A B- or Z/X-series board with a stronger VRM suits this CPU better.'));
  }
  return out;
}

function memory({ cpu, motherboard: board, ram }) {
  if (!ram.length) return [];
  const out = [];
  const types = [...new Set(ram.map((k) => k.type))];

  if (types.length > 1) {
    out.push(issue('error', 'ram-mixed-type', ram, 'DDR4 and DDR5 kits cannot be used together.', 'Keep kits of one memory type.'));
  }
  for (const k of ram) {
    if (board && k.type !== board.memoryType) {
      out.push(issue('error', 'ram-type', [k, board],
        `${k.name} is ${k.type}; ${board.name} takes ${board.memoryType}.`,
        `Pick a ${board.memoryType} kit.`));
    } else if (!board && cpu && !cpu.memoryType.includes(k.type)) {
      out.push(issue('error', 'ram-type', [k, cpu],
        `${cpu.name} does not support ${k.type}.`,
        `Pick a ${cpu.memoryType.join(' or ')} kit.`));
    }
  }

  const modules = ramModules(ram);
  const capacity = ramCapacity(ram);
  if (board) {
    if (modules > board.memorySlots) {
      out.push(issue('error', 'ram-slots', [...ram, board],
        `${plural(modules, 'memory module')} chosen, but ${board.name} has ${plural(board.memorySlots, 'slot')}.`,
        `Use at most ${board.memorySlots} modules, e.g. one ${board.memorySlots === 2 ? '2x' : '2x or 4x'} kit with larger modules.`));
    }
    if (!known(board.maxMemoryGB)) {
      out.push(unknown('ram-capacity', board, 'the maximum memory capacity', ram));
    } else if (capacity > board.maxMemoryGB) {
      out.push(issue('error', 'ram-capacity', [...ram, board],
        `${capacity} GB of memory chosen; ${board.name} supports up to ${board.maxMemoryGB} GB.`,
        `Stay at or below ${board.maxMemoryGB} GB.`));
    }
  }

  const ids = new Set(ram.map((k) => k.id));
  if (ram.length > 1) {
    out.push(ids.size > 1
      ? issue('warn', 'ram-mixed-kits', ram, 'Different memory kits are mixed. They may not run together at their rated speed, or at all.', 'Use one kit with the total capacity you need.')
      : issue('info', 'ram-two-kits', ram, 'Two copies of the same kit are not tested as a set; they usually work but may need a lower speed.', 'A single kit of the full capacity is the safer choice.'));
  }
  if (modules === 1) {
    out.push(issue('info', 'ram-single-channel', ram, 'One memory module runs in single-channel mode, which costs performance, mostly with integrated graphics and in games.', 'Two modules (a 2x kit) run in dual channel.'));
  }
  if (modules >= 4 && types[0] === 'DDR5') {
    out.push(issue('info', 'ram-ddr5-four', ram, 'Four DDR5 modules usually run well below their rated speed.', 'Two larger modules keep the rated speed.'));
  }
  return out;
}

export const rules = [cpuBoard, memory];
