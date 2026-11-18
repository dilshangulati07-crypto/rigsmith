// Storage rules: M.2 slots, SATA ports, drive bays, SATA power plugs.
import { issue, unknown, known, plural } from './util.js?v=fe48996dc3';

const nvme = (s) => s.filter((d) => d.type === 'nvme');
const sata = (s) => s.filter((d) => d.type === 'sata' || d.type === 'hdd');

function m2Slots({ storage, motherboard: board }) {
  const drives = nvme(storage);
  if (!drives.length || !board) return [];
  if (!known(board.m2Slots)) return [unknown('m2-slots', board, 'the number of M.2 slots', drives)];
  if (drives.length <= board.m2Slots) return [];
  return [issue('error', 'm2-slots', [...drives, board],
    `${plural(drives.length, 'NVMe drive')} chosen; ${board.name} has ${plural(board.m2Slots, 'M.2 slot')}.`,
    `Use at most ${board.m2Slots} NVMe drives (a PCIe M.2 adapter card can add more), or a larger single drive.`)];
}

function sataPorts({ storage, motherboard: board }) {
  const drives = sata(storage);
  if (!drives.length || !board) return [];
  if (!known(board.sataPorts)) return [unknown('sata-ports', board, 'the number of SATA ports', drives)];
  if (drives.length <= board.sataPorts) return [];
  return [issue('error', 'sata-ports', [...drives, board],
    `${plural(drives.length, 'SATA drive')} chosen; ${board.name} has ${plural(board.sataPorts, 'SATA port')}.`,
    `Use at most ${board.sataPorts} SATA drives, or move to NVMe.`)];
}

// drivebays: "3.5" = mounts that take a 3.5in drive; "2.5" = every 2.5in mount, combo bays included.
function driveBays({ storage, case: pcCase }) {
  const hdds = storage.filter((d) => d.formFactor === '3.5in');
  const ssds = storage.filter((d) => d.formFactor === '2.5in');
  if (!pcCase || !(hdds.length + ssds.length)) return [];
  if (!known(pcCase.drivebays)) return [unknown('drive-bays', pcCase, 'the drive bays', [...hdds, ...ssds])];
  const b35 = pcCase.drivebays['3.5'];
  const b25 = pcCase.drivebays['2.5'];
  const out = [];
  if (hdds.length) {
    if (!known(b35)) out.push(unknown('drive-bays', pcCase, 'the 3.5in drive bays', hdds));
    else if (hdds.length > b35) {
      out.push(issue('error', 'drive-bays', [...hdds, pcCase],
        `${pcCase.name} has ${b35 ? plural(b35, '3.5in bay') : 'no 3.5in bays'} for ${plural(hdds.length, 'hard drive')}.`,
        b35 ? `Use at most ${b35}.` : 'Use an M.2 or 2.5in SSD instead, or a case with 3.5in bays.'));
    }
  }
  if (ssds.length) {
    if (!known(b25)) out.push(unknown('drive-bays', pcCase, 'the 2.5in drive mounts', ssds));
    else if (ssds.length > b25) {
      out.push(issue('warn', 'drive-bays', [...ssds, pcCase],
        `${plural(ssds.length, '2.5in SSD')} chosen; ${pcCase.name} lists ${plural(b25, '2.5in mount')}.`,
        'SSDs are light and can sit loose or on tape, but an M.2 drive is cleaner.'));
    }
  }
  return out;
}

function sataPower({ storage, psu }) {
  const drives = sata(storage);
  if (!drives.length || !psu) return [];
  const plugs = psu.connectors?.sata;
  if (!known(plugs)) return [unknown('sata-power', psu, 'the number of SATA power plugs', drives)];
  if (drives.length <= plugs) return [];
  return [issue('warn', 'sata-power', [...drives, psu],
    `${plural(drives.length, 'SATA drive')} chosen; ${psu.name} has ${plural(plugs, 'SATA power plug')}.`,
    'Use a PSU with more SATA plugs; avoid moulded splitters.')];
}

export const rules = [m2Slots, sataPorts, driveBays, sataPower];
