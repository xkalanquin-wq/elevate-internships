import { useEffect, useState } from 'react';

/*
 * Installing the site as an app.
 *
 * Chrome, Edge and Samsung Internet fire `beforeinstallprompt` once the site
 * qualifies (manifest, icons, service worker). It can fire before React has
 * mounted, so it is caught here at import time and held until a button asks
 * for it. Safari on iPhone and iPad has no prompt at all; there the button
 * explains Share → Add to Home Screen instead.
 */

let deferredPrompt = null;
let installed = false;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Stops Chrome's own mini-infobar; the footer button offers it instead.
    e.preventDefault();
    deferredPrompt = e;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installed = true;
    notify();
  });
}

/** True when running as the installed app rather than in a browser tab. */
export function isStandalone() {
  try {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: minimal-ui)').matches ||
      window.navigator.standalone === true
    );
  } catch {
    return false;
  }
}

/** iPhone, iPad (which reports itself as a Mac) and iPod. */
export function isIOS() {
  const nav = window.navigator;
  return /iphone|ipad|ipod/i.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
}

/** Registers /sw.js in production builds. Dev servers skip it to avoid stale caches. */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* the site works the same without it */
    });
  });
}

/**
 * What the install button can do right now:
 * 'prompt' (the browser's install dialog), 'ios' (show instructions), or null
 * (already installed, or this browser cannot install).
 */
export function useInstall() {
  const [, rerender] = useState(0);
  useEffect(() => {
    const fn = () => rerender((n) => n + 1);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);

  let mode = null;
  if (!installed && !isStandalone()) {
    // Every iOS browser is Safari underneath and can only add to the home screen.
    if (isIOS()) mode = 'ios';
    else if (deferredPrompt) mode = 'prompt';
  }

  const prompt = async () => {
    const event = deferredPrompt;
    if (!event) return;
    deferredPrompt = null;
    event.prompt();
    try {
      await event.userChoice;
    } finally {
      notify();
    }
  };

  return { mode, prompt };
}
