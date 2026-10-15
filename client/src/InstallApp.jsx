import React, { useState } from 'react';
import { useInstall } from './install.js';

/**
 * "Install the app" pill for the footers. Shows only when this browser can
 * install the site (or on iPhone/iPad, where it explains how), and disappears
 * inside the installed app.
 */
export default function InstallApp({ className = '' }) {
  const { mode, prompt } = useInstall();
  const [showHow, setShowHow] = useState(false);
  if (!mode) return null;

  if (mode === 'prompt') {
    return (
      <button type="button" className={`pref-source install-app ${className}`} onClick={prompt}>
        <span className="pref-star" aria-hidden="true">
          ⬇
        </span>
        <span>
          Install the <strong>Elevate Internships app</strong>
        </span>
      </button>
    );
  }

  return (
    <div className={`install-ios ${className}`}>
      <button
        type="button"
        className="pref-source install-app"
        aria-expanded={showHow}
        aria-controls="install-ios-how"
        onClick={() => setShowHow((v) => !v)}
      >
        <span className="pref-star" aria-hidden="true">
          ⬇
        </span>
        <span>
          Add the <strong>Elevate Internships app</strong> to your home screen
        </span>
      </button>
      {showHow && (
        <p id="install-ios-how" className="install-how">
          Tap the <strong>Share</strong> button (the square with an arrow), then <strong>Add to Home Screen</strong>
          . It opens full-screen with its own icon, like any app.
        </p>
      )}
    </div>
  );
}
