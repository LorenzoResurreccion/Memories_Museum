import { useEffect, useState } from 'react';
import LoginScreen from './LoginScreen.jsx';
import { MESSAGES } from './loginMessages.js';
import { AUTH_ENABLED, probeSession as defaultProbe } from '../data/authClient.js';
import { loadMemories as defaultLoad } from '../data/loadMemories.js';
import './StartupGate.css';

/**
 * StartupGate — decides what shows before the museum, and when the museum may start.
 *
 *   auth off:  loading -> ready
 *   auth on:   checking -> (signed in) loading -> ready
 *                       -> (signed out) login -> loading -> ready
 *                       -> (unreachable) login with a "Try again" button
 *
 * `children` (the App: game + overlays) render only in `ready`, so the Phaser game never
 * starts before the letters have loaded, and nothing under /Memories/* is requested
 * while the login shows, apart from the one session probe. App itself stays the overlay
 * coordinator. Requirements: 1.1–1.5, 5.4, 5.5, 7.1–7.4.
 *
 * `authEnabled`, `probe` and `load` are injectable for tests.
 */
export default function StartupGate({
  children,
  authEnabled = AUTH_ENABLED,
  probe = defaultProbe,
  load = defaultLoad,
}) {
  const [phase, setPhase] = useState(authEnabled ? 'checking' : 'loading');
  const [loginMessage, setLoginMessage] = useState('');
  const [unreachable, setUnreachable] = useState(false);

  // checking: is she already signed in this browser session?
  useEffect(() => {
    if (phase !== 'checking') return undefined;
    let cancelled = false;
    probe().then((state) => {
      if (cancelled) return;
      if (state === 'signed-in') {
        setPhase('loading');
      } else {
        setUnreachable(state === 'unreachable');
        setLoginMessage(state === 'unreachable' ? MESSAGES.network : '');
        setPhase('login');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [phase, probe]);

  // loading: fetch the letters, then start the museum. load() never rejects.
  useEffect(() => {
    if (phase !== 'loading') return undefined;
    let cancelled = false;
    load().then((count) => {
      if (cancelled) return;
      if (count === 0) console.warn('No dialogue letters loaded from Memories/dialogue/.');
      setPhase('ready');
    });
    return () => {
      cancelled = true;
    };
  }, [phase, load]);

  if (phase === 'ready') return children;

  return (
    <div className="app-container">
      {phase === 'login' ? (
        <LoginScreen
          onSignedIn={() => setPhase('loading')}
          initialMessage={loginMessage}
          onRetry={unreachable ? () => setPhase('checking') : undefined}
        />
      ) : (
        <p className="startup-loading" role="status" aria-live="polite">
          Opening the museum…
        </p>
      )}
    </div>
  );
}
