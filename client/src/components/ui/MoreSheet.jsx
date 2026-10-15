import React, { useEffect, useRef } from 'react';
import Icon from './Icon.jsx';
import PageLinks, { plainClick } from './PageLinks.jsx';
import { usePresence } from '../../motion/index.js';

const THEMES = [
  { id: 'system', label: 'System', icon: 'system' },
  { id: 'light', label: 'Light', icon: 'sun' },
  { id: 'dark', label: 'Dark', icon: 'moon' },
];

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The phone's More tab: account, theme, font settings, feedback and the
 * site's other pages, in a sheet that rises from the bottom (a centered panel
 * on wider screens).
 *
 * It is a modal dialog: focus moves in when it opens, Tab stays inside,
 * Escape or a tap outside closes it, and focus goes back to the More button.
 * It animates in and out through usePresence from the motion layer.
 *
 * Every choice here is also on the page somewhere else — the footer, the top
 * bar on wider screens, the Account page — so nothing is only in the sheet.
 */
export default function MoreSheet({
  open,
  onClose,
  returnFocusRef,
  user,
  onAccount,
  onSignIn,
  onSignOut,
  theme,
  onSetTheme,
  consent,
  onFontSettings,
  contactEmail,
  links,
  onOpenLink,
}) {
  const panel = useRef(null);
  // The latest onClose, read by the key handler. The effect below runs once
  // per opening; depending on onClose would rerun it on every App render and
  // pull focus back to the top of the sheet.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const back = returnFocusRef?.current;
    panel.current?.querySelector(FOCUSABLE)?.focus();
    document.documentElement.classList.add('sheet-open');

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel.current) return;
      const items = [...panel.current.querySelectorAll(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.documentElement.classList.remove('sheet-open');
      back?.focus();
    };
  }, [open, returnFocusRef]);

  // Stays mounted while it animates out, then goes.
  const { mounted, state } = usePresence(open);
  if (!mounted) return null;

  // Closes the sheet before acting, so a choice that changes the screen does
  // not leave the sheet open on top of it.
  const then = (fn) => () => {
    onClose();
    fn();
  };

  return (
    <div className="sheet-layer" data-state={state} aria-hidden={state === 'closing' ? true : undefined}>
      <div className="sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="more-title" ref={panel}>
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          <h2 id="more-title" className="sheet-title">
            More
          </h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>

        <section className="sheet-section" aria-label="Account">
          {user ? (
            <>
              <a
                className="sheet-item"
                href="/account"
                onClick={(e) => {
                  if (!plainClick(e)) return;
                  e.preventDefault();
                  onClose();
                  onAccount();
                }}
              >
                <Icon name="user" />
                <span className="sheet-item-text">
                  <span className="sheet-item-title">
                    Your account {user.premium && <span className="badge premium">Premium</span>}
                  </span>
                  <span className="sheet-item-note">{user.name || user.email}</span>
                </span>
              </a>
              <button type="button" className="sheet-item" onClick={then(onSignOut)}>
                <Icon name="signOut" />
                <span className="sheet-item-title">Sign out</span>
              </button>
            </>
          ) : (
            user === false && (
              <button type="button" className="sheet-item" onClick={then(onSignIn)}>
                <Icon name="user" />
                <span className="sheet-item-text">
                  <span className="sheet-item-title">Sign in</span>
                  <span className="sheet-item-note">Save your ledger and applications to an account</span>
                </span>
              </button>
            )
          )}
        </section>

        <section className="sheet-section" aria-labelledby="more-theme">
          <h3 id="more-theme" className="sheet-label">
            Theme
          </h3>
          <div className="segmented" role="radiogroup" aria-labelledby="more-theme">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={theme === t.id}
                className="segmented-option"
                onClick={() => onSetTheme(t.id)}
              >
                <Icon name={t.icon} size={18} />
                {t.label}
              </button>
            ))}
          </div>
        </section>

        <section className="sheet-section" aria-label="Settings and feedback">
          {consent && (
            <button type="button" className="sheet-item" onClick={then(onFontSettings)}>
              <Icon name="type" />
              <span className="sheet-item-text">
                <span className="sheet-item-title">Font settings</span>
                <span className="sheet-item-note">{consent === 'granted' ? 'Google Fonts on' : 'System fonts'}</span>
              </span>
            </button>
          )}
          {contactEmail && (
            <a
              className="sheet-item"
              href={`mailto:${contactEmail}?subject=${encodeURIComponent('Elevate Internships feedback')}`}
            >
              <Icon name="mail" />
              <span className="sheet-item-title">Send feedback</span>
            </a>
          )}
        </section>

        <section className="sheet-section">
          <h3 className="sheet-label">Explore</h3>
          <PageLinks
            links={links}
            variant="list"
            label="Elevate Internships pages"
            onOpen={(href) => {
              onClose();
              onOpenLink(href);
            }}
          />
        </section>
      </div>
    </div>
  );
}
