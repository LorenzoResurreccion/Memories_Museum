import { useEffect, useRef, useState } from 'react';
import { startLogin as defaultStartLogin, finishLogin as defaultFinishLogin } from '../data/authClient.js';
import { MESSAGES, describeFailure } from './loginMessages.js';
import './LoginScreen.css';

/**
 * LoginScreen — username and password, then three questions one at a time.
 *
 * Nothing is sent while moving between questions; all three answers go to the server in
 * one request at the end, so a failure never reveals which answer was wrong. The
 * password and answers live only in this component's state.
 *
 * Props:
 *   onSignedIn()     — called once the access cookies are set
 *   initialMessage   — shown on first render (e.g. "couldn't reach the museum")
 *   onRetry()        — when given, shows a "Try again" button (used for the unreachable case)
 *   startLogin / finishLogin — injectable for tests; default to authClient
 *
 * Requirements: 2.1–2.6, 3.1–3.7, 8.7, 10.1–10.4.
 */
export default function LoginScreen({
  onSignedIn,
  initialMessage = '',
  onRetry,
  startLogin = defaultStartLogin,
  finishLogin = defaultFinishLogin,
}) {
  const [step, setStep] = useState('credentials');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [questions, setQuestions] = useState([]);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState(['', '', '']);
  const [message, setMessage] = useState(initialMessage);
  const [busy, setBusy] = useState(false);
  const [lockedUntil, setLockedUntil] = useState(null);

  const usernameRef = useRef(null);
  const passwordRef = useRef(null);
  const answerRef = useRef(null);

  // Focus the first field of each new step or question (Req 10.2).
  useEffect(() => {
    if (step === 'credentials') usernameRef.current?.focus();
    else answerRef.current?.focus();
  }, [step, index]);

  // Re-enable submission once a lockout ends (Req 8.7).
  useEffect(() => {
    if (lockedUntil === null) return undefined;
    const timer = setTimeout(() => setLockedUntil(null), Math.max(0, lockedUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [lockedUntil]);

  const locked = lockedUntil !== null;
  const disabled = busy || locked;

  function fail(result, currentStep) {
    const { message: text, lockedUntil: until } = describeFailure(result, currentStep);
    setMessage(text);
    if (until !== null) setLockedUntil(until);
  }

  async function submitCredentials(event) {
    event.preventDefault();
    if (disabled) return;
    const hasUser = username.trim() !== '';
    const hasPassword = password !== '';
    if (!hasUser || !hasPassword) {
      setMessage(!hasUser && !hasPassword ? MESSAGES.missingBoth : !hasUser ? MESSAGES.missingUsername : MESSAGES.missingPassword);
      (hasUser ? passwordRef : usernameRef).current?.focus();
      return;
    }

    setBusy(true);
    const result = await startLogin(username, password);
    setBusy(false);

    if (result.ok) {
      setQuestions(result.questions);
      setAnswers(['', '', '']);
      setIndex(0);
      setMessage('');
      setStep('questions');
      return;
    }
    if (result.reason === 'mismatch') {
      setPassword('');
      passwordRef.current?.focus();
    }
    fail(result, 'credentials');
  }

  async function submitAnswer(event) {
    event.preventDefault();
    if (disabled) return;
    if (answers[index].trim() === '') {
      setMessage(MESSAGES.missingAnswer);
      answerRef.current?.focus();
      return;
    }
    if (index < questions.length - 1) {
      setMessage('');
      setIndex(index + 1);
      return;
    }

    setBusy(true);
    const result = await finishLogin(username, password, answers);
    setBusy(false);

    if (result.ok) {
      // Drop the secrets before handing over to the museum.
      setPassword('');
      setAnswers(['', '', '']);
      onSignedIn?.();
      return;
    }
    if (result.reason === 'mismatch') {
      setAnswers(['', '', '']);
      setIndex(0);
      answerRef.current?.focus();
    }
    fail(result, 'questions');
  }

  function goBack() {
    if (index === 0 || busy) return;
    setMessage('');
    setIndex(index - 1);
  }

  function updateAnswer(value) {
    setAnswers((prev) => prev.map((a, i) => (i === index ? value : a)));
  }

  return (
    <div className="login-screen">
      <div className="login-panel">
        <h1 className="login-title">The Living Museum</h1>

        {step === 'credentials' ? (
          <form className="login-form" onSubmit={submitCredentials} noValidate>
            <label className="login-label" htmlFor="login-username">Username</label>
            <input
              id="login-username"
              ref={usernameRef}
              className="login-input"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <label className="login-label" htmlFor="login-password">Password</label>
            <input
              id="login-password"
              ref={passwordRef}
              className="login-input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <div className="login-actions">
              <button className="login-button" type="submit" disabled={disabled}>
                {busy ? 'Checking…' : 'Continue'}
              </button>
            </div>
          </form>
        ) : (
          <form className="login-form" onSubmit={submitAnswer} noValidate>
            <p className="login-progress">
              {index + 1} of {questions.length}
            </p>
            <label className="login-label login-question" htmlFor="login-answer">
              {questions[index]}
            </label>
            <input
              id="login-answer"
              ref={answerRef}
              className="login-input"
              type="text"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={answers[index]}
              onChange={(e) => updateAnswer(e.target.value)}
            />
            <div className="login-actions">
              {index > 0 && (
                <button className="login-button login-button-secondary" type="button" onClick={goBack} disabled={busy}>
                  Back
                </button>
              )}
              <button className="login-button" type="submit" disabled={disabled}>
                {busy ? 'Checking…' : index < questions.length - 1 ? 'Continue' : 'Enter the museum'}
              </button>
            </div>
          </form>
        )}

        <p className="login-message" role="status" aria-live="polite">
          {message}
        </p>

        {onRetry && step === 'credentials' && (
          <button className="login-button login-button-secondary login-retry" type="button" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
