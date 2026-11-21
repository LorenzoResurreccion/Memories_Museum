import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import LoginScreen from '../LoginScreen.jsx';
import { MESSAGES, tooManyTriesMessage } from '../loginMessages.js';

const QUESTIONS = ['Where was our first brunch?', "What is our dog's name?", 'Where did we meet?'];

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
  sessionStorage.clear();
});

function setup({ start = { ok: true, questions: QUESTIONS }, finish = { ok: true }, ...props } = {}) {
  const startLogin = vi.fn(async () => (typeof start === 'function' ? start() : start));
  const finishLogin = vi.fn(async () => (typeof finish === 'function' ? finish() : finish));
  const onSignedIn = vi.fn();
  render(<LoginScreen onSignedIn={onSignedIn} startLogin={startLogin} finishLogin={finishLogin} {...props} />);
  return { startLogin, finishLogin, onSignedIn };
}

const status = () => screen.getByRole('status').textContent;
const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submitStep = (label) => act(async () => fireEvent.submit(screen.getByLabelText(label).closest('form')));

async function signInToQuestions(username = 'kelly', password = 'pw') {
  type('Username', username);
  type('Password', password);
  await submitStep('Password');
}

async function answerAll(answers) {
  for (let i = 0; i < 3; i += 1) {
    type(QUESTIONS[i], answers[i]);
    await submitStep(QUESTIONS[i]);
  }
}

describe('LoginScreen', () => {
  describe('credential step', () => {
    it('has labelled username and password fields with the right autocomplete hints', () => {
      setup();
      const user = screen.getByLabelText('Username');
      const pass = screen.getByLabelText('Password');
      expect(user.getAttribute('autocomplete')).toBe('username');
      expect(pass.getAttribute('type')).toBe('password');
      expect(pass.getAttribute('autocomplete')).toBe('current-password');
      expect(document.activeElement).toBe(user);
    });

    it.each([
      ['both empty', '', '', MESSAGES.missingBoth],
      ['no username', '   ', 'pw', MESSAGES.missingUsername],
      ['no password', 'kelly', '', MESSAGES.missingPassword],
    ])('%s: sends nothing and says what is missing', async (_label, u, p, message) => {
      const { startLogin } = setup();
      type('Username', u);
      type('Password', p);
      await submitStep('Password');
      expect(startLogin).not.toHaveBeenCalled();
      expect(status()).toBe(message);
    });

    it('Enter (form submit) sends the username and password', async () => {
      const { startLogin } = setup();
      await signInToQuestions('Kelly', 'secret');
      expect(startLogin).toHaveBeenCalledWith('Kelly', 'secret');
    });

    it('a mismatch keeps the username, clears the password and focuses it', async () => {
      setup({ start: { ok: false, reason: 'mismatch' } });
      await signInToQuestions('kelly', 'wrong');
      expect(status()).toBe(MESSAGES.credentialsMismatch);
      expect(screen.getByLabelText('Username').value).toBe('kelly');
      expect(screen.getByLabelText('Password').value).toBe('');
      expect(document.activeElement).toBe(screen.getByLabelText('Password'));
    });

    it.each([
      ['network', MESSAGES.network],
      ['unavailable', MESSAGES.unavailable],
      ['bad-request', MESSAGES.badRequest],
    ])('a %s failure shows plain wording and keeps both fields', async (reason, message) => {
      setup({ start: { ok: false, reason } });
      await signInToQuestions('kelly', 'pw');
      expect(status()).toBe(message);
      expect(screen.getByLabelText('Password').value).toBe('pw');
      expect(status()).not.toMatch(/\d{3}|error|exception/i);
    });

    it('disables Continue while the request is in flight', async () => {
      let resolve;
      setup({ start: () => new Promise((r) => { resolve = r; }) });
      type('Username', 'kelly');
      type('Password', 'pw');
      fireEvent.submit(screen.getByLabelText('Password').closest('form'));
      expect(screen.getByRole('button', { name: 'Checking…' }).disabled).toBe(true);
      await act(async () => resolve({ ok: true, questions: QUESTIONS }));
    });
  });

  describe('question step', () => {
    it('shows one question at a time with its number, and focuses the answer', async () => {
      setup();
      await signInToQuestions();
      expect(screen.getByText('1 of 3')).toBeTruthy();
      const field = screen.getByLabelText(QUESTIONS[0]);
      expect(field.getAttribute('autocomplete')).toBe('off');
      expect(document.activeElement).toBe(field);
      expect(screen.queryByLabelText(QUESTIONS[1])).toBeNull();
      expect(screen.queryByText('Back')).toBeNull(); // no Back on question 1
    });

    it('moves between questions without sending anything, and Back restores the earlier answer', async () => {
      const { finishLogin } = setup();
      await signInToQuestions();
      type(QUESTIONS[0], 'short stack');
      await submitStep(QUESTIONS[0]);
      expect(screen.getByText('2 of 3')).toBeTruthy();
      expect(document.activeElement).toBe(screen.getByLabelText(QUESTIONS[1]));
      fireEvent.click(screen.getByText('Back'));
      expect(screen.getByLabelText(QUESTIONS[0]).value).toBe('short stack');
      expect(finishLogin).not.toHaveBeenCalled();
    });

    it('an empty answer does not continue', async () => {
      setup();
      await signInToQuestions();
      type(QUESTIONS[0], '   ');
      await submitStep(QUESTIONS[0]);
      expect(status()).toBe(MESSAGES.missingAnswer);
      expect(screen.getByText('1 of 3')).toBeTruthy();
    });

    it('sends the credentials and all three answers in one request, then signs in', async () => {
      const { finishLogin, onSignedIn } = setup();
      await signInToQuestions('Kelly', 'pw');
      await answerAll(['short stack', 'koda', 'madison']);
      expect(finishLogin).toHaveBeenCalledTimes(1);
      expect(finishLogin).toHaveBeenCalledWith('Kelly', 'pw', ['short stack', 'koda', 'madison']);
      expect(onSignedIn).toHaveBeenCalledTimes(1);
    });

    it('the last button says "Enter the museum"', async () => {
      setup();
      await signInToQuestions();
      for (let i = 0; i < 2; i += 1) {
        type(QUESTIONS[i], 'x');
        await submitStep(QUESTIONS[i]);
      }
      expect(screen.getByRole('button', { name: 'Enter the museum' })).toBeTruthy();
    });

    it('a mismatch returns to question 1 with all answers cleared and one generic message', async () => {
      const { onSignedIn } = setup({ finish: { ok: false, reason: 'mismatch' } });
      await signInToQuestions();
      await answerAll(['a', 'b', 'c']);
      expect(status()).toBe(MESSAGES.answersMismatch);
      expect(screen.getByText('1 of 3')).toBeTruthy();
      expect(screen.getByLabelText(QUESTIONS[0]).value).toBe('');
      expect(document.activeElement).toBe(screen.getByLabelText(QUESTIONS[0]));
      expect(onSignedIn).not.toHaveBeenCalled();
      // Going forward again, the other answers are cleared too.
      type(QUESTIONS[0], 'a');
      await submitStep(QUESTIONS[0]);
      expect(screen.getByLabelText(QUESTIONS[1]).value).toBe('');
    });
  });

  describe('attempt limit', () => {
    it('429 with Retry-After disables submission, shows minutes, and re-enables when it ends', async () => {
      vi.useFakeTimers();
      setup({ start: { ok: false, reason: 'rate-limited', retryAfterSeconds: 61 } });
      await signInToQuestions();
      expect(status()).toBe(tooManyTriesMessage(61));
      expect(status()).toContain('2 minutes');
      const button = screen.getByRole('button', { name: 'Continue' });
      expect(button.disabled).toBe(true);
      await act(async () => vi.advanceTimersByTime(60_000));
      expect(button.disabled).toBe(true);
      await act(async () => vi.advanceTimersByTime(1_000));
      expect(button.disabled).toBe(false);
    });

    it('429 without Retry-After is "busy", not a lockout', async () => {
      setup({ start: { ok: false, reason: 'rate-limited' } });
      await signInToQuestions();
      expect(status()).toBe(MESSAGES.busy);
      expect(screen.getByRole('button', { name: 'Continue' }).disabled).toBe(false);
    });

    it('tooManyTriesMessage rounds up to whole minutes, with a singular', () => {
      expect(tooManyTriesMessage(1)).toContain('in 1 minute.');
      expect(tooManyTriesMessage(60)).toContain('in 1 minute.');
      expect(tooManyTriesMessage(900)).toContain('in 15 minutes.');
    });
  });

  it('shows the initial message and a Try again button when given onRetry', () => {
    const onRetry = vi.fn();
    setup({ initialMessage: MESSAGES.network, onRetry });
    expect(status()).toBe(MESSAGES.network);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('never stores the password or answers in browser storage', async () => {
    setup();
    await signInToQuestions('kelly', 'secret pw');
    await answerAll(['short stack', 'koda', 'madison']);
    const stored = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.cookie;
    expect(stored).not.toMatch(/secret pw|short stack|koda|madison/);
  });

  it('offers no reset, sign-up, remember-me or sign-out controls', () => {
    setup();
    expect(screen.queryByText(/forgot|reset|sign up|create account|remember me|sign out|log out/i)).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
