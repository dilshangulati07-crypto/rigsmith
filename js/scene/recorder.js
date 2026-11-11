// "Save as video": records the 3D canvas with MediaRecorder at its current size and quality.
// Each frame is copied (right after it is drawn) onto a 2D canvas with a clean overlay, so
// the video has the build name, price and wordmark but none of the page's buttons.
// MP4 (H.264) when the browser can record it, otherwise WebM.
const FORMATS = [
  ['video/mp4;codecs=avc1.42E01F', 'mp4'], ['video/mp4;codecs=avc1', 'mp4'], ['video/mp4', 'mp4'],
  ['video/webm;codecs=vp9', 'webm'], ['video/webm;codecs=vp8', 'webm'], ['video/webm', 'webm'],
];
const even = (n) => Math.max(2, Math.floor(n / 2) * 2);

/** { mime, ext } this browser can record, or null. */
export function videoFormat() {
  if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement.prototype.captureStream !== 'function') return null;
  const f = FORMATS.find(([m]) => MediaRecorder.isTypeSupported?.(m));
  return f ? { mime: f[0], ext: f[1] } : null;
}

/**
 * Start recording `source` (a canvas). Call frame() after every render.
 * @param {HTMLCanvasElement} source
 * @param {{ draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, fps?: number }} opts
 *   draw paints the overlay (and anything else) over the copied frame.
 */
export function createRecorder(source, { draw, fps = 60 }) {
  const format = videoFormat();
  if (!format) throw new Error('Video recording is not supported in this browser.');
  const out = document.createElement('canvas');
  out.width = even(source.width);
  out.height = even(source.height);
  const ctx = out.getContext('2d', { alpha: false });
  const stream = out.captureStream(fps);
  // About 0.12 bits per pixel per frame at 30 fps: sharp at 1080p without huge files.
  const bits = Math.round(Math.min(16e6, Math.max(4e6, out.width * out.height * 30 * 0.12)));
  const rec = new MediaRecorder(stream, { mimeType: format.mime, videoBitsPerSecond: bits });
  const chunks = [];
  let bytes = 0;
  rec.ondataavailable = (e) => {
    if (!e.data?.size) return;
    chunks.push(e.data);
    bytes += e.data.size;
  };
  const t0 = performance.now();
  let stopped = false;
  const end = () => {
    stopped = true;
    stream.getTracks().forEach((t) => t.stop());
  };
  rec.start(500);

  return {
    format,
    width: out.width,
    height: out.height,
    get bytes() { return bytes; },
    get seconds() { return (performance.now() - t0) / 1000; },
    frame() {
      if (stopped) return;
      ctx.drawImage(source, 0, 0, out.width, out.height);
      draw(ctx, out.width, out.height);
    },
    /** Finish and return the video as a Blob. */
    stop() {
      return new Promise((resolve, reject) => {
        if (stopped) { reject(new Error('Recording already stopped.')); return; }
        rec.onstop = () => {
          end();
          resolve(new Blob(chunks, { type: format.mime.split(';')[0] }));
          chunks.length = 0;
        };
        rec.onerror = (e) => { end(); reject(e.error ?? new Error('Recording failed.')); };
        rec.stop();
      });
    },
    cancel() {
      if (stopped) return;
      rec.ondataavailable = null;
      rec.onstop = null;
      if (rec.state !== 'inactive') rec.stop();
      end();
      chunks.length = 0;
    },
  };
}
