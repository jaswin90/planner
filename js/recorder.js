// Voice notes: record from the microphone in the browser (MediaRecorder).
import { h, modal, toast } from './ui.js';

function pickType() {
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (window.MediaRecorder?.isTypeSupported?.(t)) return t;
  }
  return '';
}

/** Show a recording dialog. Resolves to a File, or null if cancelled. */
export function recordVoice() {
  return new Promise(async (resolve) => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      toast('Voice recording is not supported in this browser.', 'error');
      return resolve(null);
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast('Microphone permission was denied.', 'error');
      return resolve(null);
    }
    const type = pickType();
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks = [];
    let keep = false, done = false;
    const started = Date.now();
    const clock = h('div', { class: 'rec-clock' }, '0:00');
    const tick = setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      if (s >= 600) stop(true); // 10 minute cap
    }, 250);
    function stop(save) {
      if (done) return;
      done = true; keep = save;
      clearInterval(tick);
      if (rec.state !== 'inactive') rec.stop();
      m.close();
    }
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (!keep || !chunks.length) return resolve(null);
      const mime = (rec.mimeType || type || 'audio/webm').split(';')[0];
      const ext = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
      const stamp = new Date().toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      resolve(new File(chunks, `Voice note ${stamp}.${ext}`, { type: mime }));
    };
    const m = modal('Recording voice note', h('div', { class: 'stack rec' },
      h('div', { class: 'rec-dot' }), clock,
      h('div', { class: 'row end' },
        h('button', { class: 'btn', onclick: () => stop(false) }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: () => stop(true) }, '■ Stop & save'))), { onClose: () => stop(keep) });
    rec.start(1000);
  });
}
