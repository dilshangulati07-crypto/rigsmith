import { unit } from '../dom.js?v=4fbe99bdc0';
import { cpuScores } from '../../perf.js?v=4fbe99bdc0';

export default {
  keySpecs: (p) => [
    ['Socket', p.socket],
    ['Cores', `${p.cores}C / ${p.threads}T`],
    ['Boost', unit(p.boostClockGHz, ' GHz')],
    ['Power', `${p.tdp} / ${p.maxPowerW ?? '?'} W`],
    ['Graphics', p.igpu ? 'Integrated' : 'None'],
  ],
  specs: (p) => [
    ['Socket', p.socket],
    ['Generation', p.generation],
    ['Architecture', p.architecture],
    ['Cores / threads', `${p.cores} / ${p.threads}`],
    ['Base clock', unit(p.baseClockGHz, ' GHz')],
    ['Boost clock', unit(p.boostClockGHz, ' GHz')],
    ['Base power (TDP)', unit(p.tdp, ' W')],
    ['Max power', unit(p.maxPowerW, ' W')],
    ['Memory', p.memoryType.join(', ')],
    ['Integrated graphics', p.igpu ? (p.igpuName ?? 'Yes') : 'None'],
    ['Cooler in box', p.coolerIncluded === null || p.coolerIncluded === undefined ? null : p.coolerIncluded ? 'Yes' : 'No'],
    ['Launch year', p.launchYear],
  ],
  filters: [
    { id: 'socket', label: 'Socket', kind: 'select', get: (p) => p.socket },
    { id: 'memory', label: 'Memory', kind: 'select', get: (p) => p.memoryType },
    { id: 'igpu', label: 'Graphics', kind: 'select', get: (p) => (p.igpu ? 'Integrated' : 'None') },
    { id: 'cores', label: 'Min cores', kind: 'min', get: (p) => p.cores },
  ],
  sorts: [
    { id: 'cores', label: 'Most cores', compare: (a, b) => b.cores - a.cores },
    { id: 'st', label: 'Single-thread estimate', compare: (a, b) => cpuScores(b).st - cpuScores(a).st },
    { id: 'gaming', label: 'Gaming estimate', compare: (a, b) => cpuScores(b).gaming - cpuScores(a).gaming },
  ],
};
