import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import EmptyState from './components/ui/EmptyState.jsx';
// Tokens first: every stylesheet after it reads its values.
import './tokens.css';
import './styles.css';
// The app shell and shared components; after styles.css so they win ties.
import './components/ui/ui.css';
// Must come after styles.css: the kinetic layer's utilities are allowed to
// override component CSS, and Tailwind's preflight is disabled so nothing
// above is reset by loading it.
import './index.css';
// Micro-animations: press ripples, pops and the tab underline.
import './motion.css';
import { registerServiceWorker } from './install.js';
import { reportError, startErrorReporting } from './errors.js';
import { startMotion } from './motion.js';

registerServiceWorker();
startErrorReporting();
startMotion();

/**
 * If a part of the page crashes while drawing, show a way out instead of a
 * blank screen, and report it. Saved data lives on the server or in this
 * browser, so reloading loses nothing.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    reportError(error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="wrap">
        <EmptyState
          as="main"
          id="main"
          level={1}
          title="Something went wrong on this page."
          illustration="error"
          action={
            <button type="button" className="btn" onClick={() => window.location.reload()}>
              Reload the page
            </button>
          }
        >
          Your saved internships and certifications are safe. Reloading usually fixes it; the problem has been reported.
        </EmptyState>
      </div>
    );
  }
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
