import React, { useEffect, useRef, useState } from 'react';
import { splitWords, useReveal } from './useReveal';
import { validateZip } from '../../validate';

const HEADLINE = 'The internship tracker for business majors.';

/**
 * The hero, with the app's actual entry point in it.
 *
 * The ZIP field here is not a decorative stand-in that scrolls you to a real
 * form further down — it submits, and Home hands the value straight to the
 * Finder. A landing page that makes you type your ZIP twice is worse than no
 * landing page.
 *
 * The headline rises word by word out of a mask. Each word carries its own
 * delay so the line assembles left to right; the whole string is given to
 * assistive tech at once via aria-label, because hearing a sentence arrive
 * one word per element is not an improvement.
 */
export default function Hero({ onSearch, onBrowse }) {
  const headingRef = useReveal({ threshold: 0.1 });
  const bodyRef = useReveal({ threshold: 0.1, step: 7 });
  const [zip, setZip] = useState('');
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  // The mask children animate off the same [data-revealed] the heading gets,
  // so they are staggered by writing --k-step onto each one after mount.
  useEffect(() => {
    const el = headingRef.current;
    if (!el) return;
    el.querySelectorAll('.k-mask').forEach((mask, i) => {
      mask.style.setProperty('--k-step', String(i));
    });
  }, [headingRef]);

  // The masks need [data-revealed] themselves — they are siblings of the
  // heading's own reveal, not descendants of a revealed wrapper.
  useEffect(() => {
    const el = headingRef.current;
    if (!el) return undefined;
    const obs = new MutationObserver(() => {
      if (!el.hasAttribute('data-revealed')) return;
      el.querySelectorAll('.k-mask').forEach((m) => m.setAttribute('data-revealed', ''));
      obs.disconnect();
    });
    obs.observe(el, { attributes: true, attributeFilter: ['data-revealed'] });
    if (el.hasAttribute('data-revealed')) {
      el.querySelectorAll('.k-mask').forEach((m) => m.setAttribute('data-revealed', ''));
      obs.disconnect();
    }
    return () => obs.disconnect();
  }, [headingRef]);

  function submit(e) {
    e.preventDefault();
    const trimmed = zip.trim();
    // Reuse the Finder's validator rather than a second copy of the rules —
    // the wording a student sees here must match what they see there.
    const message = validateZip(trimmed);
    if (message) {
      setError(message);
      inputRef.current?.focus();
      return;
    }
    setError(null);
    onSearch?.(trimmed);
  }

  return (
    <section className="mx-auto max-w-page px-s4 pb-s7 pt-s8" aria-labelledby="k-hero-title">
      <p className="mb-s4 font-mono text-xs uppercase tracking-label text-faint">
        For business students
      </p>

      <h1
        ref={headingRef}
        id="k-hero-title"
        aria-label={HEADLINE}
        className="k-reveal max-w-prose font-display text-hero font-semibold leading-display tracking-display text-ink"
      >
        {splitWords(HEADLINE).map((word, i) =>
          /^\s+$/.test(word) ? (
            <span key={i}> </span>
          ) : (
            <span key={i} className="k-mask" aria-hidden="true">
              <span>{word}</span>
            </span>
          ),
        )}
      </h1>

      <div ref={bodyRef} className="k-reveal">
        <p className="mt-s5 max-w-prose text-md leading-relaxed text-muted">
          Real listings near you, free and low-cost certifications worth putting on a resume, and a
          ledger that remembers what you have finished.
        </p>

        <form onSubmit={submit} noValidate className="mt-s6 flex flex-wrap items-start gap-s3">
          <div className="flex flex-col">
            <label htmlFor="k-hero-zip" className="mb-s2">
              ZIP code
            </label>
            <input
              id="k-hero-zip"
              ref={inputRef}
              type="text"
              inputMode="numeric"
              autoComplete="postal-code"
              maxLength={5}
              value={zip}
              onChange={(e) => {
                setZip(e.target.value.replace(/\D/g, ''));
                if (error) setError(null);
              }}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'k-hero-zip-err' : undefined}
              placeholder="06010"
              className="h-tap w-zip rounded-token border border-solid border-field bg-surface px-s3 font-mono text-ink outline-none focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus"
            />
            {error && (
              <span id="k-hero-zip-err" className="field-error mt-s2" role="alert">
                {error}
              </span>
            )}
          </div>

          <button type="submit" className="btn k-field-offset min-h-tap">
            Find internships
          </button>

          <button type="button" className="btn ghost k-field-offset min-h-tap" onClick={onBrowse}>
            Browse certifications
          </button>
        </form>

        <p className="mt-s4 font-mono text-xs uppercase tracking-label text-faint">
          No account needed to search
        </p>
      </div>
    </section>
  );
}
