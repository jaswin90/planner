// Per-browser preferences (non-secret UI settings only).
import { CONFIG } from './config.js';

const DEFAULTS = { autoLockMinutes: CONFIG.autoLockMinutes };

export function getPref(k) {
  try {
    const v = JSON.parse(localStorage.getItem('planner.prefs') || '{}')[k];
    return v ?? DEFAULTS[k];
  } catch { return DEFAULTS[k]; }
}

export function setPref(k, v) {
  try {
    const all = JSON.parse(localStorage.getItem('planner.prefs') || '{}');
    all[k] = v;
    localStorage.setItem('planner.prefs', JSON.stringify(all));
  } catch { /* storage blocked: keep default */ }
}
