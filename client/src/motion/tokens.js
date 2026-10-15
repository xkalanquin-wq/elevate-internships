// Motion values for JavaScript, read from the CSS tokens in tokens.css so a
// script animation and a CSS one always agree — including the global switch:
// with reduced motion on, every duration reads as 0.
//
// A mobile build replaces this file with constants from its own theme.

let probe = null;

/** A duration token in milliseconds, resolved by the browser (calc, the switch and all). */
export function durationMs(name) {
  if (typeof document === 'undefined') return 0;
  if (!probe) {
    probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none';
    document.body.appendChild(probe);
  }
  probe.style.transitionDuration = `var(${name})`;
  const v = getComputedStyle(probe).transitionDuration.split(',')[0].trim();
  const n = parseFloat(v) || 0;
  return v.endsWith('ms') ? n : n * 1000;
}

/** A curve token, as a string the Web Animations API accepts. */
export function easing(name) {
  if (typeof document === 'undefined') return 'ease-out';
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || 'ease-out';
}

/** A plain number token (for example --stagger-max). */
export function numberToken(name, fallback = 0) {
  if (typeof document === 'undefined') return fallback;
  const n = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(n) ? n : fallback;
}

/** True when movement should not play: the device setting or data-motion="reduce" on <html>. */
export function reducedMotion() {
  if (typeof window === 'undefined') return false;
  if (document.documentElement.dataset.motion === 'reduce') return true;
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}
