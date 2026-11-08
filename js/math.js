// Equations: KaTeX (vendored, loaded on first use) rendered as MathML, which
// every current browser draws natively, so no extra fonts or inline styles
// are needed under our Content-Security-Policy.

let loading = null;

export function loadKatex() {
  if (window.katex) return Promise.resolve(window.katex);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/katex/katex.min.js';
      s.onload = () => resolve(window.katex);
      s.onerror = () => { loading = null; reject(new Error('Could not load the equation engine.')); };
      document.head.append(s);
    });
  }
  return loading;
}

/** Render TeX into `el`. Errors are shown in place instead of thrown. */
export async function renderTex(el, tex, displayMode) {
  try {
    const katex = await loadKatex();
    // KaTeX escapes all text it outputs; trust:false blocks \\href, \\url, etc.
    el.innerHTML = katex.renderToString(tex, { displayMode, output: 'mathml', throwOnError: true, trust: false, strict: 'ignore', maxSize: 50, maxExpand: 500 });
    el.removeAttribute('title');
    el.classList.remove('eq-err');
  } catch (e) {
    el.textContent = tex;
    el.title = e.message || 'Equation error';
    el.classList.add('eq-err');
  }
}
