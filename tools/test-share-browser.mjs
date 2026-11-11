#!/usr/bin/env node
// Browser scenario for Phase 6 in headless Chrome (tools/browser-harness.mjs):
// - landing: eight preset cards with prices, focus bars and links; 3D thumbnails render
//   once and come from the cache after a reload (no second render);
// - builder: ?preset= loads a preset and keeps unsaved work in Saved builds; &play=1 starts
//   the Auto-build cinematic; the Presets dialog; "Copy link" says Copied and the link
//   decodes to the build; a link with build-by-hand state reopens every part and cable;
//   links with unknown ids load what they can and say what was left out; damaged links
//   leave the build alone;
// - export: the print stylesheet shows only the spec sheet (with a QR code) and prints on
//   one A4 page; the CSV downloads with search links;
// - compare: default columns, sticky header with thumbnails, differences and best values,
//   "Swap this part" with live deltas, undo, add and remove columns, the URL follows,
//   bad links explain themselves; head and body scroll together at 380 px;
// - 380 px: no sideways page scroll on landing, builder and compare. Any console error fails.
// Usage: node tools/test-share-browser.mjs [--shots <dir>] [-v]
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUILDS, catalog } from './test-builds.mjs';
import { encodeBuild, decodeBuild, readShareParams } from '../js/share.js';
import { encodeHand, plansFor } from '../js/share-hand.js';
import {
  ok, fail, finish, sleep, page, evaluate, waitFor, viewport, shot, consoleErrors, BASE, HELPERS,
} from './browser-harness.mjs';

const go = async (url, ready = 'true') => {
  await page('Page.navigate', { url: BASE + url });
  await waitFor(`document.readyState === "complete" && (${ready})`, url, 40000);
};
const builderReady = `document.getElementById('loader')?.dataset.done === 'true'`;
const toastText = () => evaluate(`document.getElementById('toast').textContent`);
const noSideScroll = async (label) => {
  const w = await evaluate('document.documentElement.scrollWidth');
  ok(w <= (await evaluate('innerWidth')), `${label}: no sideways page scroll (scrollWidth ${w})`);
};
const sample = BUILDS[0].build;
const sampleCode = encodeBuild(sample, catalog);

try {
  await viewport(1280, 900);
  await go('/index.html');
  await evaluate('localStorage.clear(); sessionStorage.clear()');

  // ---------------------------------------------------------------- landing
  console.log('Landing page presets');
  await go('/index.html');
  await evaluate(`document.getElementById('presets').scrollIntoView()`);
  await waitFor(`document.querySelectorAll('.preset').length === 8`, 'preset cards', 20000);
  const cards = await evaluate(`[...document.querySelectorAll('.preset')].map((c) => ({
    name: c.querySelector('.preset__name').textContent, price: c.querySelector('.preset__facts dd').textContent,
    bars: c.querySelectorAll('.preset__bars .gauge').length, note: c.querySelector('.preset__note').textContent,
    open: c.querySelector('a.btn--primary').getAttribute('href'), watch: [...c.querySelectorAll('a.btn')][1].getAttribute('href'),
    compare: c.querySelector('.preset__compare').getAttribute('href') }))`);
  ok(cards.every((c) => /^฿[\d,]+$/.test(c.price) && c.bars === 3 && /Reference price, not live/.test(c.note)), 'every card has a reference total, three focus bars and the price note');
  ok(cards.every((c) => /^builder\.html\?preset=[a-z0-9-]+$/.test(c.open) && /^builder\.html\?preset=[a-z0-9-]+&play=1$/.test(c.watch)), `"Open in builder" and "Watch it build" links (${cards[0].watch})`);
  ok(cards.every((c) => readShareParams(new URL(c.compare, BASE).search)[0]?.name === c.name), 'each card links to Compare with its build');
  await waitFor(`[...document.querySelectorAll('.preset .thumb')].slice(0, 4).every((t) => t.dataset.state === 'ready')`, 'first row of thumbnails', 90000);
  ok(await evaluate(`[...document.querySelectorAll('.preset .thumb img')].slice(0, 4).every((i) => i.naturalWidth >= 300 && /^3D render of /.test(i.alt))`), 'thumbnails are images with alt text');
  ok(await evaluate(`document.querySelectorAll('canvas').length`) === 2, 'one extra WebGL canvas renders every thumbnail (hero + thumbnails)');
  await evaluate(`window.scrollTo(0, document.body.scrollHeight)`);
  await waitFor(`[...document.querySelectorAll('.preset .thumb')].every((t) => t.dataset.state === 'ready')`, 'all thumbnails', 90000);
  const cached = await evaluate(`Object.keys(JSON.parse(sessionStorage.getItem('rigsmith.thumbs.v1') || '{}')).length`);
  ok(cached === 8, `thumbnails cached (${cached})`);
  await shot('landing-presets');
  await go('/index.html');
  await evaluate(`document.getElementById('presets').scrollIntoView()`);
  await waitFor(`[...document.querySelectorAll('.preset .thumb')].slice(0, 4).every((t) => t.dataset.state === 'ready')`, 'cached thumbnails', 20000);
  ok(await evaluate(`document.querySelectorAll('canvas').length`) === 1, 'after a reload the thumbnails come from the cache (no thumbnail renderer)');

  // ---------------------------------------------------------------- builder: presets
  console.log('Builder: presets and links');
  // Unsaved work in progress first, then a preset link replaces it.
  await evaluate(`localStorage.setItem('rigsmith.build.v1', JSON.stringify({ version: 1, parts: ${JSON.stringify(Object.fromEntries(Object.entries(sample).map(([k, v]) => [k, Array.isArray(v) ? v.map((p) => p.id) : v?.id ?? null])))} }))`);
  await go('/builder.html?preset=mid-1440p', builderReady);
  await sleep(300);
  const t1 = await toastText();
  ok(/^Preset loaded: Mid gaming 1440p\. Your previous build is in Builds as “Unsaved build \(kept/.test(t1), `preset link loads and keeps unsaved work: "${t1}"`);
  ok(await evaluate(`location.search`) === '' && await evaluate(`document.getElementById('build-name').textContent`) === 'Mid gaming 1440p', 'URL cleaned up, title shows the preset');
  ok(await evaluate(`JSON.parse(localStorage.getItem('rigsmith.saved.v1'))[0].data.parts.cpu`) === sample.cpu.id, 'the kept build is in Saved builds with its parts');
  ok(await evaluate(`JSON.parse(localStorage.getItem('rigsmith.build.v1')).parts.cpu`) === 'amd-ryzen-5-7600', 'the preset is the build in progress');

  // Presets dialog (keyboard R), cards and buttons.
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }))`);
  await waitFor(`document.getElementById('presets-dialog').open && document.querySelectorAll('#presets-dialog .preset').length === 8`, 'presets dialog');
  ok(await evaluate(`document.querySelectorAll('#presets-dialog [data-action="open"]').length === 8 && document.querySelectorAll('#presets-dialog [data-action="watch"]').length === 8`), 'R opens the Presets dialog with Open and Watch buttons');
  await shot('builder-presets-dialog');
  await evaluate(`document.querySelector('#presets-dialog [data-preset="compact-itx"][data-action="open"]').click()`);
  await sleep(200);
  ok(await evaluate(`document.querySelector('#presets-dialog [data-preset="compact-itx"][data-action="open"]').textContent`) === 'Replace unsaved build?', 'replacing an unsaved build asks first');
  await evaluate(`document.querySelector('#presets-dialog [data-preset="compact-itx"][data-action="open"]').click()`);
  await sleep(300);
  ok(!(await evaluate(`document.getElementById('presets-dialog').open`)) && await evaluate(`JSON.parse(localStorage.getItem('rigsmith.build.v1')).parts.case`) === 'cooler-master-masterbox-nr200p', 'second click applies the preset');

  // Copy link: "Copied", and the link decodes to the build.
  await evaluate(`Clipboard.prototype.writeText = async function (t) { window.__copied = t; }`);
  await evaluate(`document.querySelector('[data-cmd="copy-link"]').click()`);
  await waitFor(`!!window.__copied`, 'copy');
  ok(await evaluate(`document.querySelector('[data-cmd="copy-link"]').textContent.trim()`) === 'Copied' && /copied/.test(await evaluate(`document.getElementById('copy-status').textContent`)), 'Copy link shows "Copied" (and tells screen readers)');
  const copied = await evaluate('window.__copied');
  const back = decodeBuild(readShareParams(new URL(copied).search)[0].code, catalog);
  ok(back.ok && back.ids.case === 'cooler-master-masterbox-nr200p' && back.ids.gpu === 'nvidia-geforce-rtx-4070-super-founders-edition' && /n=Compact\+ITX/.test(copied), `the copied link is the build: ${copied}`);
  ok(await waitFor(`document.querySelector('[data-cmd="copy-link"]').textContent.trim() === 'Copy link'`, 'label reset', 5000).catch(() => false), '... and goes back to "Copy link"');

  // Shared link opens straight in a new browser: same build.
  await evaluate('localStorage.clear()');
  await go(new URL(copied).pathname + new URL(copied).search, builderReady);
  await sleep(200);
  ok(await evaluate(`JSON.parse(localStorage.getItem('rigsmith.build.v1')).parts.gpu`) === 'nvidia-geforce-rtx-4070-super-founders-edition' && /^Loaded a shared build: Compact ITX\.$/.test(await toastText()), `the link restores the build in a fresh browser ("${await toastText()}")`);

  // Unknown and wrong ids: load the rest and say what was left out.
  const bad = sampleCode.split('.');
  bad[1] = 'zzzz';
  bad[4] = 'nope-gpu-id';
  await go(`/builder.html?b=${bad.join('.')}&n=Broken`, builderReady);
  await sleep(200);
  const t2 = await toastText();
  ok(/2 parts in this link \(processor, graphics card\) are not in the parts catalogue and were left out\. Everything else loaded\./.test(t2) && await evaluate(`document.getElementById('toast').dataset.level`) === 'warn', `unknown ids: "${t2}"`);
  const partial = await evaluate(`JSON.parse(localStorage.getItem('rigsmith.build.v1')).parts`);
  ok(partial.cpu === null && partial.gpu === null && partial.motherboard === sample.motherboard.id && partial.case === sample.case.id, 'everything else loaded');
  await go('/builder.html?b=7.zz.yy', builderReady);
  await sleep(200);
  ok(/different version/.test(await toastText()) && await evaluate(`JSON.parse(localStorage.getItem('rigsmith.build.v1')).parts.motherboard`) === sample.motherboard.id, `a damaged link leaves the build alone: "${await toastText()}"`);

  // Build-by-hand state in the link: every part in, every cable on its route, panel closed.
  const plans = plansFor(sample);
  const pieces = plans.aplan.groups.flatMap((g) => g.pieces);
  const items = plans.cplan.items.filter((i) => !i.unavailable);
  const hand = encodeHand(sample, { installed: pieces, cables: Object.fromEntries(items.map((i) => [i.id, { pts: null, src: null, dst: null }])), closed: true, cableStyle: { kind: 'white', color: '#ff5a1f' } }, plans);
  await evaluate('localStorage.clear()');
  await go(`/builder.html?debug3d&b=${sampleCode}&h=${hand}&n=Hand+built`, `!!window.rigsmith3d`);
  await evaluate(HELPERS);
  await waitFor('__t.r().hand.active && __t.idle() && __t.c().count3d > 0', 'the hand build from the link', 60000);
  ok((await evaluate('__t.installed()')).length === pieces.length && await evaluate('__t.c().count3d') === items.length, `the link reopens Build by hand with all ${pieces.length} pieces and ${items.length} cables`);
  ok(await evaluate('__t.r().scene.sidePanel') && await evaluate('__t.saved().style.kind') === 'white', 'closed side panel and cable style come back too');
  ok(/Build by hand: \d+ pieces in and \d+ cables connected, as shared\./.test(await toastText()), `says so: "${await toastText()}"`);
  ok(await evaluate(`location.search`) === '?debug3d', 'link params removed from the address bar');
  await shot('builder-hand-link');
  // Copying again carries the hand state.
  await evaluate(`Clipboard.prototype.writeText = async function (t) { window.__copied = t; }; window.__copied = null`);
  await evaluate(`document.querySelector('[data-cmd="copy-link"]').click()`);
  await waitFor(`!!window.__copied`, 'copy');
  ok(readShareParams(new URL(await evaluate('window.__copied')).search)[0].hand === hand, 'Copy link includes the build-by-hand progress');

  // Preset link with "Watch it build": the cinematic plays.
  await go('/builder.html?debug3d&preset=high-1440p&play=1', `!!window.rigsmith3d`);
  ok(await waitFor('window.rigsmith3d.auto?.active', 'cinematic', 30000).catch(() => false), '"Watch it build" plays the Auto-build cinematic');
  await evaluate(`window.rigsmith3d.setMode('viewer')`);

  // ---------------------------------------------------------------- export
  console.log('Export: print and CSV');
  await go('/builder.html?preset=4k-flagship', builderReady);
  await evaluate(`window.__printed = 0; window.print = () => { window.__printed++; }`);
  await evaluate(`document.querySelector('.menu summary').click()`);
  ok(await evaluate(`document.querySelector('.menu').open`), 'Export menu opens');
  await evaluate(`document.querySelector('[data-cmd="print"]').click()`);
  ok(await evaluate('window.__printed') === 1 && !(await evaluate(`document.querySelector('.menu').open`)), 'Print spec sheet opens the print dialog (and closes the menu)');
  await page('Emulation.setEmulatedMedia', { media: 'print' });
  const sheet = await evaluate(`(() => {
    const s = document.querySelector('#print-sheet .sheet');
    return { mainHidden: getComputedStyle(document.getElementById('main')).display === 'none', shown: getComputedStyle(document.getElementById('print-sheet')).display === 'block',
      rows: s.querySelectorAll('.sheet__parts tbody tr').length, qr: !!s.querySelector('.sheet__qr svg path'), text: s.textContent, bg: getComputedStyle(document.body).backgroundColor };
  })()`);
  ok(sheet.mainHidden && sheet.shown && sheet.bg === 'rgb(255, 255, 255)', 'print media: only the spec sheet, on white');
  ok(sheet.rows === 9 && sheet.qr && /reference price, not live/.test(sheet.text) && /4K flagship/.test(sheet.text) && /headroom/.test(sheet.text) && /9 of 9 parts/.test(sheet.text), 'sheet has every part, the QR code, the price note, power, and verification');
  const pdf = await page('Page.printToPDF', { preferCSSPageSize: true, printBackground: true });
  const pages = (Buffer.from(pdf.data, 'base64').toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  ok(pages === 1, `the spec sheet prints on one page (${pages})`);
  await shot('print-sheet');
  await page('Emulation.setEmulatedMedia', { media: '' });

  const dir = await mkdtemp(join(tmpdir(), 'rigsmith-dl-'));
  await page('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
  await evaluate(`document.querySelector('[data-cmd="csv"]').click()`);
  let files = [];
  for (let i = 0; i < 50 && !files.some((f) => f.endsWith('.csv')); i++) { await sleep(100); files = await readdir(dir); }
  const csvName = files.find((f) => f.endsWith('.csv'));
  ok(!!csvName && /^rigsmith-4k-flagship-\d{4}-\d{2}-\d{2}\.csv$/.test(csvName), `CSV downloads (${csvName})`);
  if (csvName) {
    const csv = await readFile(join(dir, csvName), 'utf8');
    ok(csv.startsWith('﻿Category,Part,') && (csv.match(/https:\/\/www\.google\.com\/search\?tbm=shop/g) || []).length === 9 && /Share link: http/.test(csv), 'CSV has a header, a search link per part and the share link');
  }
  await rm(dir, { recursive: true, force: true });

  // ---------------------------------------------------------------- compare
  console.log('Compare');
  await go('/compare.html', `document.querySelectorAll('.cmp__colhead').length >= 3`);
  const names = await evaluate(`[...document.querySelectorAll('.cmp__name')].map((e) => e.textContent)`);
  ok(names.length === 3 && names[0] === 'Current build' && names[1] === 'Mid gaming 1440p', `default columns: the current build and presets (${names.join(', ')})`);
  ok(readShareParams(await evaluate('location.search')).length === 3, 'the URL holds the comparison');
  await waitFor(`[...document.querySelectorAll('.cmp__thumb')].every((t) => t.dataset.state === 'ready')`, 'compare thumbnails', 60000);
  ok(await evaluate(`document.querySelectorAll('.cmp__thumb img').length`) === 3, 'a 3D thumbnail per column in the header');
  const rows = await evaluate(`[...document.querySelectorAll('.cmp__body .cmp__label')].map((e) => e.firstChild.textContent.trim())`);
  for (const r of ['Total price', 'Est. peak power', 'PSU headroom', 'Size (case)', 'Compatibility', 'Verified parts', '1080p gaming', 'AI / compute', 'Processor', 'Case fans']) ok(rows.includes(r), `row: ${r}`);
  ok(await evaluate(`document.querySelectorAll('.cmp__cell[data-diff="true"]').length`) > 6 && await evaluate(`document.querySelectorAll('.cmp__best').length`) > 4 && await evaluate(`document.querySelectorAll('.cmp__part-specs .is-diff').length`) > 4, 'differences and best values are marked');
  // Sticky header while scrolling.
  await evaluate(`window.scrollTo(0, 1200)`);
  await sleep(150);
  ok(Math.abs(await evaluate(`document.querySelector('.cmp__head').getBoundingClientRect().top`) - 56) < 2, 'header with thumbnails stays under the top bar while scrolling');
  await evaluate(`window.scrollTo(0, 0)`);

  // Swap the graphics card in column C: live deltas, then the table follows.
  const totalBefore = await evaluate(`document.querySelectorAll('.cmp__total')[2].textContent`);
  await evaluate(`document.querySelector('[data-act="swap"][data-col="2"][data-cat="gpu"]').click()`);
  await waitFor(`document.getElementById('swap-dialog').open && document.querySelectorAll('.swap__row').length > 10`, 'swap dialog');
  const sw = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('.swap__row')];
    return { first: rows[0].dataset.current === 'true', deltas: rows.slice(1, 4).map((r) => r.querySelector('.swap__deltas').textContent.replace(/\\s+/g, ' ').trim()), count: document.querySelector('.swap__count').textContent };
  })()`);
  ok(sw.first && sw.deltas.every((d) => /Price\s*฿[\d,]+ \([+−±]/.test(d) && /Perf/.test(d) && /Power/.test(d)), `each option shows what it changes ("${sw.deltas[0]}")`);
  await shot('compare-swap');
  await evaluate(`(() => { const i = document.querySelector('#swap-dialog input[name="q"]'); i.value = '4090'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await waitFor(`[...document.querySelectorAll('.swap__name')].every((n) => /4090/.test(n.textContent))`, 'search');
  const pick = await evaluate(`document.querySelector('.swap__row [data-pick]').dataset.pick`);
  await evaluate(`document.querySelector('.swap__row [data-pick]').click()`);
  await sleep(200);
  ok(!(await evaluate(`document.getElementById('swap-dialog').open`)) && (await evaluate(`[...document.querySelectorAll('.cmp__row--part')][3].querySelectorAll('.cmp__part-name')[2].textContent`)).includes('4090'), `column C now has ${pick}`);
  ok(await evaluate(`document.querySelectorAll('.cmp__total')[2].textContent`) !== totalBefore && /1 part swapped · \+฿/.test(await evaluate(`document.querySelector('.cmp__changed').textContent`)), 'total and the "swapped" note update');
  ok(decodeBuild(readShareParams(await evaluate('location.search'))[2].code, catalog).ids.gpu === pick, 'the URL follows the swap');
  await evaluate(`document.querySelector('[data-act="undo"]').click()`);
  ok(await evaluate(`document.querySelectorAll('.cmp__total')[2].textContent`) === totalBefore && !(await evaluate(`document.querySelector('.cmp__changed')`)), 'Undo puts the column back');

  // Remove a column, add one from the picker.
  await evaluate(`document.querySelector('[data-act="remove"][data-col="0"]').click()`);
  ok(await evaluate(`document.querySelectorAll('.cmp__colhead:not(.cmp__colhead--add)').length`) === 2 && !!(await evaluate(`document.querySelector('.cmp__add select')`)), 'remove a column; the add picker appears');
  await evaluate(`(() => { const s = document.querySelector('.cmp__add select'); s.value = 'preset:silent-office'; s.form.requestSubmit(); })()`);
  ok((await evaluate(`[...document.querySelectorAll('.cmp__name')].map((e) => e.textContent)`)).at(-1) === 'Silent office', 'add a preset column');
  ok(await evaluate(`document.querySelectorAll('.cmp__row--part')[3].querySelectorAll('.cmp__cell')[2].textContent.includes('None')`), 'a build without a graphics card shows "None" there');
  // Copy the comparison.
  await evaluate(`Clipboard.prototype.writeText = async function (t) { window.__copied = t; }`);
  await evaluate(`document.querySelector('[data-cmd="copy-link"]').click()`);
  await waitFor('!!window.__copied', 'copy');
  ok(readShareParams(new URL(await evaluate('window.__copied')).search).map((c) => c.name).join('|') === 'Mid gaming 1440p|High-end 1440p|Silent office', 'Copy link copies the comparison on screen');
  // Print all: one sheet per build.
  await evaluate(`window.print = () => {}; document.querySelector('[data-cmd="print-all"]').click()`);
  ok(await evaluate(`document.querySelectorAll('#print-sheet .sheet').length`) === 3, 'Print spec sheets: one sheet per build');
  await shot('compare');

  // A compare link with problems.
  await go(`/compare.html?b=${bad.join('.')}&n=Broken&b=9.x&n=Future&b=${sampleCode}`, `document.querySelectorAll('.cmp__colhead').length >= 2`);
  const msg = await evaluate(`document.getElementById('cmp-msg').textContent`);
  ok(/Broken: 2 parts in this link/.test(msg) && /Future: This link was made by a different version/.test(msg), `bad columns are explained: "${msg.replace(/\s+/g, ' ').slice(0, 110)}…"`);
  ok((await evaluate(`[...document.querySelectorAll('.cmp__name')].map((e) => e.textContent)`)).join('|') === 'Broken|Build C', 'and the readable columns still load');

  // ---------------------------------------------------------------- 380 px
  console.log('380 px wide');
  await viewport(380, 820, true);
  await go('/index.html');
  await evaluate(`document.getElementById('presets').scrollIntoView()`);
  await waitFor(`document.querySelectorAll('.preset').length === 8`, 'cards');
  await sleep(300);
  await noSideScroll('landing');
  await shot('380-landing-presets');
  await go('/builder.html', builderReady);
  await sleep(300);
  await noSideScroll('builder');
  const barFits = await evaluate(`[...document.querySelectorAll('.builder__actions > *')].every((e) => e.getBoundingClientRect().right <= innerWidth + 1)`);
  ok(barFits, 'builder action bar wraps inside 380 px');
  await evaluate(`document.querySelector('[data-cmd="presets"]').click()`);
  await waitFor(`document.querySelectorAll('#presets-dialog .preset').length === 8`, 'dialog');
  ok(await evaluate(`[...document.querySelectorAll('#presets-dialog .preset')].every((e) => e.getBoundingClientRect().right <= innerWidth)`), 'Presets dialog fits');
  await shot('380-builder-presets');
  await go('/compare.html', `document.querySelectorAll('.cmp__colhead').length >= 2`);
  await sleep(300);
  await noSideScroll('compare');
  await evaluate(`document.querySelector('.cmp__body').scrollLeft = 200`);
  await sleep(100);
  ok(Math.abs(await evaluate(`document.querySelector('.cmp__head').scrollLeft`) - 200) < 2, 'header scrolls sideways with the columns');
  ok(await evaluate(`document.querySelector('.cmp__body .cmp__label').getBoundingClientRect().left`) >= 0 && await evaluate(`getComputedStyle(document.querySelector('.cmp__body .cmp__label')).position`) === 'sticky', 'row labels stay pinned');
  await shot('380-compare');

  ok(consoleErrors.length === 0, `no console errors${consoleErrors.length ? `:\n    ${consoleErrors.slice(0, 8).join('\n    ')}` : ''}`);
} catch (err) {
  fail(err);
}
await finish();
