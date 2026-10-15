// Micro-interactions: a ripple on every button press, and confetti for the
// moments worth celebrating (an offer, an application sent, a certification
// finished). No library: a few dozen lines of canvas.
//
// Everything here is decoration. It is skipped entirely for people who ask
// for reduced motion, and it never blocks or delays the action itself.
// Timing and colors come from the tokens, like every other animation.

import { durationMs, reducedMotion as reduced } from './motion/index.js';

// Where the last press happened, so a burst starts from the button pressed.
let lastPoint = null;

const RIPPLE_TARGETS = '.btn, .link-btn, .tab, .theme-toggle, .check, .suggestion';

export function startMotion() {
  if (typeof document === 'undefined') return;
  // Lets motion.css start entrances from hidden: only now that a script is
  // running to reveal them again.
  document.documentElement.classList.add('motion-ready');
  document.addEventListener(
    'pointerdown',
    (e) => {
      lastPoint = { x: e.clientX, y: e.clientY };
      if (reduced() || e.button !== 0) return;
      const el = e.target.closest?.(RIPPLE_TARGETS);
      if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
      const rect = el.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 2;
      const dot = document.createElement('span');
      dot.className = 'ripple';
      dot.setAttribute('aria-hidden', 'true');
      dot.style.width = dot.style.height = `${size}px`;
      dot.style.left = `${e.clientX - rect.left - size / 2}px`;
      dot.style.top = `${e.clientY - rect.top - size / 2}px`;
      el.appendChild(dot);
      dot.addEventListener('animationend', () => dot.remove(), { once: true });
      // Safety net if the animation never runs (hidden tab, removed element).
      setTimeout(() => dot.remove(), durationMs('--duration-ripple') * 2);
    },
    { passive: true },
  );
}

/** The palette, read live so confetti matches the light or dark theme. */
function paletteColors() {
  const css = getComputedStyle(document.documentElement);
  return ['--accent', '--amber', '--accent-soft', '--faint', '--accent', '--amber'].map((t) => css.getPropertyValue(t).trim());
}

/**
 * Confetti from a point (the last press, by default).
 * size: 'small' for a quick burst, 'big' for a shower across the screen.
 */
export function confetti({ size = 'small', x, y } = {}) {
  if (reduced() || typeof document === 'undefined') return;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return;
  }
  ctx.scale(dpr, dpr);

  const big = size === 'big';
  const COLORS = paletteColors();
  const origin = { x: x ?? lastPoint?.x ?? w / 2, y: y ?? lastPoint?.y ?? h / 3 };
  const count = big ? 160 : 60;
  const pieces = Array.from({ length: count }, (_, i) => {
    // A big shower falls from across the top as well as bursting from the button.
    const fromTop = big && i % 2 === 0;
    const angle = fromTop ? Math.PI / 2 + (Math.random() - 0.5) * 0.6 : -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1;
    const speed = fromTop ? 2 + Math.random() * 3 : 5 + Math.random() * (big ? 9 : 6);
    return {
      x: fromTop ? Math.random() * w : origin.x,
      y: fromTop ? -20 - Math.random() * h * 0.3 : origin.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: 3 + Math.random() * 4,
      spin: Math.random() * Math.PI,
      vspin: (Math.random() - 0.5) * 0.3,
      color: COLORS[i % COLORS.length],
      shape: i % 3,
    };
  });

  const start = performance.now();
  const life = durationMs(big ? '--duration-confetti-big' : '--duration-confetti');
  if (!life) {
    canvas.remove();
    return;
  }
  const frame = (now) => {
    const t = now - start;
    ctx.clearRect(0, 0, w, h);
    const fade = Math.max(0, 1 - Math.max(0, t - life * 0.6) / (life * 0.4));
    for (const p of pieces) {
      p.vy += 0.18; // gravity
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.spin += p.vspin;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.spin);
      ctx.fillStyle = p.color;
      if (p.shape === 0) ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r);
      else if (p.shape === 1) {
        ctx.beginPath();
        ctx.arc(0, 0, p.r / 1.4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(0, -p.r);
        ctx.lineTo(p.r, p.r);
        ctx.lineTo(-p.r, p.r);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
    if (t < life) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}
