/** @type {import('tailwindcss').Config} */

/* Tailwind is scoped to the kinetic layer only.
 *
 * The rest of this app is ~1500 lines of hand-written CSS in client/src/styles.css,
 * and it stays that way. Two rules keep the two systems from fighting:
 *
 *   1. preflight is OFF. Tailwind's base reset would strip the existing
 *      typography, list and form styling out from under every other component.
 *   2. Colours, fonts and spacing map to the CSS custom properties that
 *      styles.css already defines, rather than redeclaring hex values here.
 *      That is the whole point of the mapping: the theme toggle and the
 *      prefers-color-scheme block keep working for kinetic components for
 *      free, because `bg-surface` resolves to var(--surface) at paint time,
 *      not to a colour frozen at build time.
 *
 * Consequence worth knowing: opacity modifiers (bg-surface/50) do NOT work on
 * these colours, because a var() is not a channel triple. Use the explicit
 * *-scrim / *-veil tokens below when you need transparency.
 */

export default {
  content: [
    './client/src/pages/**/*.{js,jsx}',
    './client/src/components/kinetic/**/*.{js,jsx}',
  ],

  // The app sets data-theme="dark" on <html>; it also honours the OS setting.
  // styles.css already handles both, so `dark:` here is only for the rare case
  // where a kinetic component needs a genuinely different treatment rather
  // than a different colour.
  darkMode: ['selector', '[data-theme="dark"]'],

  corePlugins: {
    preflight: false,
  },

  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        faint: 'var(--faint)',
        rule: 'var(--rule)',
        field: 'var(--field-border)',
        accent: 'var(--accent)',
        'accent-soft': 'var(--accent-soft)',
        amber: 'var(--amber)',
        focus: 'var(--focus)',
      },

      fontFamily: {
        display: 'var(--font-display)',
        body: 'var(--font-body)',
        mono: 'var(--font-mono)',
      },

      // Mirrors --sp-1..--sp-8 so kinetic spacing lands on the same rhythm as
      // everything else. Tailwind's own numeric scale stays available too.
      spacing: {
        s1: 'var(--sp-1)',
        s2: 'var(--sp-2)',
        s3: 'var(--sp-3)',
        s4: 'var(--sp-4)',
        s5: 'var(--sp-5)',
        s6: 'var(--sp-6)',
        s7: 'var(--sp-7)',
        s8: 'var(--sp-8)',
      },

      // Type, shape, depth and control sizes all read tokens.css, so the
      // /home components use the same scale as the rest of the site.
      fontSize: {
        xs: 'var(--text-xs)',
        sm: 'var(--text-sm)',
        base: 'var(--text-base)',
        md: 'var(--text-md)',
        lg: 'var(--text-lg)',
        xl: 'var(--text-xl)',
        '2xl': 'var(--text-2xl)',
        title: 'var(--text-title)',
        display: 'var(--text-display)',
        hero: 'var(--text-hero)',
      },

      lineHeight: {
        display: 'var(--leading-display)',
      },

      letterSpacing: {
        label: 'var(--tracking-label)',
        display: 'var(--tracking-display)',
      },

      borderRadius: {
        DEFAULT: 'var(--radius)',
        token: 'var(--radius)',
        xs: 'var(--radius-xs)',
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        pill: 'var(--radius-pill)',
      },

      boxShadow: {
        1: 'var(--shadow-1)',
        2: 'var(--shadow-2)',
        3: 'var(--shadow-3)',
        ring: 'var(--ring)',
      },

      minWidth: {
        tap: 'var(--tap)',
      },

      minHeight: {
        tap: 'var(--tap)',
        control: 'var(--control-h)',
      },

      height: {
        tap: 'var(--tap)',
        control: 'var(--control-h)',
      },

      width: {
        zip: 'var(--field-zip)',
      },

      maxWidth: {
        // The reading measure, and the wider measure for app screens.
        page: 'var(--read-max)',
        wide: 'var(--page-max)',
        prose: 'var(--prose-max)',
      },

      // Durations from the motion tokens: duration-fast, -base, -slow.
      transitionDuration: {
        fast: 'var(--duration-fast)',
        base: 'var(--duration-base)',
        slow: 'var(--duration-slow)',
      },

      transitionTimingFunction: {
        token: 'var(--ease)',
      },

      keyframes: {
        // Headline words rise out of a clipping mask. Translation only —
        // no blur, no scale — so text stays crisp on low-DPI screens.
        rise: {
          '0%': { transform: 'translateY(105%)' },
          '100%': { transform: 'translateY(0)' },
        },
        // Section entrances: a short, shallow lift. 12px, not 60px.
        surface: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        // The ticker. -50% because the track renders its children twice, so
        // the loop point is invisible.
        marquee: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        // The rule under an active nav item, drawn from the leading edge.
        underline: {
          '0%': { transform: 'scaleX(0)' },
          '100%': { transform: 'scaleX(1)' },
        },
        // A single sweep across a loading skeleton.
        sheen: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(200%)' },
        },
      },

      animation: {
        rise: 'rise var(--duration-slow) var(--ease) both',
        surface: 'surface var(--duration-slow) var(--ease) both',
        marquee: 'marquee var(--ticker-duration) linear infinite',
        underline: 'underline var(--duration-base) var(--ease) both',
        sheen: 'sheen var(--duration-shimmer) var(--ease) infinite',
      },
    },
  },

  plugins: [],
};
