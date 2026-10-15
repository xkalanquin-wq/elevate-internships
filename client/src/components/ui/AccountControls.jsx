import React from 'react';
import Icon from './Icon.jsx';
import { plainClick } from './PageLinks.jsx';

const THEME_ICON = { system: 'system', light: 'sun', dark: 'moon' };

/**
 * Account and theme controls for the top bar.
 *
 * Tablets and desktops show them in full: Premium badge, name (to Account),
 * Sign out, or Sign in; and the theme button, which cycles System → Light →
 * Dark as before. Phones show only the account button — the rest lives in the
 * More sheet, which is where a phone app keeps it.
 *
 * `user` is undefined while the session is loading, false when signed out.
 */
export default function AccountControls({ user, theme, onTheme, onAccount, onSignIn, onSignOut }) {
  return (
    <div className="account-controls">
      {user ? (
        <span className="account">
          <a
            className="account-name account-link"
            href="/account"
            onClick={(e) => {
              if (!plainClick(e)) return;
              e.preventDefault();
              onAccount();
            }}
          >
            <Icon name="user" size={18} className="account-icon" />
            {user.premium && <span className="badge premium">Premium</span>}{' '}
            {/* Visible from tablet width up; on a phone the icon stands in and
                the name stays readable to screen readers. */}
            <span className="account-label">{user.name || user.email}</span>
          </a>
          <button type="button" className="theme-toggle wide-only" onClick={onSignOut}>
            Sign out
          </button>
        </span>
      ) : (
        user === false && (
          <button type="button" className="theme-toggle" onClick={onSignIn}>
            Sign in
          </button>
        )
      )}
      <button
        type="button"
        className="theme-toggle theme-button wide-only"
        onClick={onTheme}
        aria-label={`Theme: ${theme}. Activate to change.`}
      >
        <Icon name={THEME_ICON[theme] || 'system'} size={18} />
        <span className="theme-name">{theme}</span>
      </button>
    </div>
  );
}
