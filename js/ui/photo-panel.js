// Photo mode for the 3D view: the stage fills the window with the page UI hidden, and a small
// bar offers the camera angle, the background (studio dark, studio light, desk), depth of
// field (click the PC to choose what is sharp) and a high-resolution PNG at 2x or 4x.
// H hides the bar too; Esc leaves. Depth of field needs High or Ultra quality.
import * as THREE from 'three';
import { CAMERA_PRESETS } from '../scene/camera-rig.js';
import { BACKDROPS } from '../scene/stage.js';
import { CONFIG } from '../config.js';
import { html, render } from './dom.js';

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'build';

/**
 * @param {HTMLElement} el the bar's container, inside the viewer stage
 * @param {{root: HTMLElement, app: object, viewer: object, stage: object, bscene: object, rig: object, onChange?: Function}} ctx
 */
export function mountPhotoPanel(el, { root, app, viewer, stage, bscene, rig, onChange }) {
  let active = false;
  let busy = false;
  const dof = { on: false, blur: 40 };
  const raycaster = new THREE.Raycaster();
  const dir = new THREE.Vector3();
  const canvas = root.querySelector('canvas');

  render(el, html`
    <div class="photo__bar" role="group" aria-label="Photo mode">
      <div class="photo__group">
        <span class="label">Angle</span>
        <div class="vgroup">${CAMERA_PRESETS.map((p) => html`<button class="vbtn" type="button" data-p="cam" data-cam="${p.id}">${p.label}</button>`)}</div>
      </div>
      <label class="photo__group"><span class="label">Background</span>
        <select class="input input--sm" data-p="backdrop">${BACKDROPS.map((b) => html`<option value="${b.id}">${b.label}</option>`)}</select>
      </label>
      <div class="photo__group">
        <label class="check"><input type="checkbox" data-p="dof"> Depth of field</label>
        <label class="photo__range"><span class="visually-hidden">Background blur</span>
          <input type="range" min="5" max="100" step="5" value="40" data-p="blur" disabled>
        </label>
      </div>
      <div class="photo__group">
        <span class="label">Save PNG</span>
        <div class="vgroup">
          <button class="vbtn" type="button" data-p="export" data-scale="2">2x</button>
          <button class="vbtn" type="button" data-p="export" data-scale="4">4x</button>
        </div>
      </div>
      <span class="photo__spacer"></span>
      <button class="vbtn" type="button" data-p="hide" aria-keyshortcuts="H">Hide controls</button>
      <button class="vbtn" type="button" data-p="exit" aria-keyshortcuts="Escape">Exit photo mode</button>
    </div>
    <p class="photo__note mono" data-p="note" aria-live="polite"></p>`);
  const q = (k) => el.querySelector(`[data-p="${k}"]`);
  const note = (text) => { q('note').textContent = text; };

  // Distance along the view direction, which is what the lens focuses on.
  function depthOf(point) {
    viewer.camera.getWorldDirection(dir);
    return point.clone().sub(viewer.camera.position).dot(dir);
  }
  function applyDof(focus) {
    const usable = viewer.quality !== 'low';
    q('dof').disabled = !usable;
    q('blur').disabled = !usable || !dof.on;
    viewer.post.setDof({ on: active && dof.on && usable, blur: dof.blur / 100, ...(focus ? { focus } : {}) });
  }
  function baseNote() {
    if (viewer.quality === 'low') return 'Depth of field needs High or Ultra quality.';
    return dof.on ? 'Click the PC to choose what is in focus. Drag to turn it.' : 'Drag to turn the PC, scroll to zoom.';
  }

  function enter() {
    if (active) return;
    active = true;
    root.dataset.photo = 'true';
    document.documentElement.classList.add('is-photo');
    el.hidden = false;
    el.dataset.bar = 'on';
    q('backdrop').value = stage.backdrop;
    bscene.highlight(null);
    applyDof(viewer.controls ? depthOf(viewer.controls.target) : 100);
    note(baseNote());
    q('exit').focus();
    onChange?.(true);
  }
  function leave() {
    if (!active) return;
    active = false;
    delete root.dataset.photo;
    document.documentElement.classList.remove('is-photo');
    el.hidden = true;
    stage.setBackdrop('dark');
    viewer.post.setDof({ on: false });
    viewer.invalidateShadows();
    onChange?.(false);
  }

  async function exportPng(scale) {
    if (busy) return;
    busy = true;
    note(`Rendering at ${scale}x…`);
    bscene.setHelpersVisible(false);
    try {
      const shot = await viewer.captureScaled(scale);
      if (!shot.blob) throw new Error('no image');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(shot.blob);
      a.download = `${slug(CONFIG.appName)}-${slug(app.ui.current?.name ?? app.ui.suggestedName ?? 'build')}-${shot.width}x${shot.height}.png`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      note(`Saved ${shot.width} × ${shot.height} px PNG.`);
    } catch (err) {
      console.warn('Rigsmith: photo export failed.', err);
      note('Could not render at that size on this device. Try 2x, or a smaller window.');
    }
    busy = false;
  }

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    const p = b.dataset.p;
    if (p === 'cam') rig.goTo(b.dataset.cam);
    if (p === 'export') exportPng(Number(b.dataset.scale));
    if (p === 'hide') setBar(false);
    if (p === 'exit') leave();
  });
  el.addEventListener('change', (e) => {
    const p = e.target.dataset?.p;
    if (p === 'backdrop') { stage.setBackdrop(e.target.value); viewer.invalidateShadows(); }
    if (p === 'dof') { dof.on = e.target.checked; applyDof(); note(baseNote()); }
  });
  el.addEventListener('input', (e) => {
    if (e.target.dataset?.p === 'blur') { dof.blur = Number(e.target.value); applyDof(); }
  });

  function setBar(on) {
    el.dataset.bar = on ? 'on' : 'off';
    note(on ? baseNote() : '');
    if (!on) canvas.focus?.();
  }
  document.addEventListener('keydown', (e) => {
    if (!active || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === 'Escape') { e.preventDefault(); if (el.dataset.bar === 'off') setBar(true); else leave(); }
    if (e.key === 'h' || e.key === 'H') { e.preventDefault(); setBar(el.dataset.bar === 'off'); }
  });

  return {
    get active() { return active; },
    toggle: () => (active ? leave() : enter()),
    enter, leave,
    /** A click on the 3D view (normalised device coordinates): focus on what was hit. */
    focusAt(ndc) {
      if (!active || !dof.on) return;
      raycaster.setFromCamera(ndc, viewer.camera);
      const hit = raycaster.intersectObject(bscene.root, true).find((h) => { for (let o = h.object; o; o = o.parent) if (!o.visible) return false; return true; });
      if (!hit) return;
      applyDof(depthOf(hit.point));
      note(`Focus set ${Math.round(hit.distance)} cm from the camera.`);
    },
    /** Quality changed while in photo mode. */
    refresh() { if (active) { applyDof(); note(baseNote()); } },
  };
}
