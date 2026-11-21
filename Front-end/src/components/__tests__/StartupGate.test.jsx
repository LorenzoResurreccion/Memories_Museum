import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

// The LoginScreen inside the gate uses the real authClient by default; stub its calls.
const { startLogin, finishLogin } = vi.hoisted(() => ({ startLogin: vi.fn(), finishLogin: vi.fn() }));
vi.mock('../../data/authClient.js', () => ({
  AUTH_ENABLED: false,
  probeSession: vi.fn(),
  startLogin,
  finishLogin,
}));

import StartupGate from '../StartupGate.jsx';
import { MESSAGES } from '../loginMessages.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  startLogin.mockReset();
  finishLogin.mockReset();
});

const Museum = () => <div>MUSEUM</div>;
const flush = () => act(async () => {});

/** A promise you resolve by hand, to hold a phase open. */
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function gate(props) {
  return render(
    <StartupGate {...props}>
      <Museum />
    </StartupGate>,
  );
}

describe('StartupGate', () => {
  it('auth off: loads the letters, then shows the museum, and never probes', async () => {
    const probe = vi.fn();
    const load = vi.fn(async () => 32);
    gate({ authEnabled: false, probe, load });
    expect(screen.getByRole('status').textContent).toBe('Opening the museum…');
    await flush();
    expect(screen.getByText('MUSEUM')).toBeTruthy();
    expect(probe).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('never renders the museum before the letters finish loading', async () => {
    const pending = deferred();
    gate({ authEnabled: true, probe: async () => 'signed-in', load: () => pending.promise });
    await flush();
    expect(screen.queryByText('MUSEUM')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Opening the museum…');
    await act(async () => pending.resolve(32));
    expect(screen.getByText('MUSEUM')).toBeTruthy();
  });

  it('signed in already (a refresh): goes straight to loading, with no login', async () => {
    const load = vi.fn(async () => 32);
    gate({ authEnabled: true, probe: async () => 'signed-in', load });
    await flush();
    await flush();
    expect(screen.getByText('MUSEUM')).toBeTruthy();
    expect(screen.queryByLabelText('Username')).toBeNull();
  });

  it('signed out: shows the login and loads nothing until sign-in', async () => {
    const load = vi.fn(async () => 32);
    gate({ authEnabled: true, probe: async () => 'signed-out', load });
    await flush();
    expect(screen.getByLabelText('Username')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(load).not.toHaveBeenCalled();
    expect(screen.queryByText('MUSEUM')).toBeNull();
  });

  it('a full sign-in through the login moves on to loading, then the museum', async () => {
    startLogin.mockResolvedValue({ ok: true, questions: ['Q1', 'Q2', 'Q3'] });
    finishLogin.mockResolvedValue({ ok: true });
    const load = vi.fn(async () => 32);
    gate({ authEnabled: true, probe: async () => 'signed-out', load });
    await flush();

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'kelly' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    await act(async () => fireEvent.submit(screen.getByLabelText('Password').closest('form')));
    for (const q of ['Q1', 'Q2', 'Q3']) {
      fireEvent.change(screen.getByLabelText(q), { target: { value: 'x' } });
      await act(async () => fireEvent.submit(screen.getByLabelText(q).closest('form')));
    }
    await flush();
    expect(finishLogin).toHaveBeenCalledWith('kelly', 'pw', ['x', 'x', 'x']);
    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.getByText('MUSEUM')).toBeTruthy();
  });

  it('unreachable: shows the login with the network message and Try again, which re-probes', async () => {
    const probe = vi.fn().mockResolvedValueOnce('unreachable').mockResolvedValueOnce('signed-in');
    gate({ authEnabled: true, probe, load: async () => 1 });
    await flush();
    expect(screen.getByRole('status').textContent).toBe(MESSAGES.network);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Try again' })));
    await flush();
    await flush();
    expect(probe).toHaveBeenCalledTimes(2);
    expect(screen.getByText('MUSEUM')).toBeTruthy();
  });

  it('warns in the console when no letters loaded, and still opens the museum', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    gate({ authEnabled: false, load: async () => 0 });
    await flush();
    expect(warn).toHaveBeenCalledWith('No dialogue letters loaded from Memories/dialogue/.');
    expect(screen.getByText('MUSEUM')).toBeTruthy();
  });

  it('ignores a late result after unmounting', async () => {
    const pending = deferred();
    const { unmount } = gate({ authEnabled: false, load: () => pending.promise });
    unmount();
    await act(async () => pending.resolve(32));
    expect(screen.queryByText('MUSEUM')).toBeNull();
  });

  it('renders the page background container while not ready', async () => {
    const { container } = gate({ authEnabled: true, probe: async () => 'signed-out', load: async () => 1 });
    await flush();
    expect(container.querySelector('.app-container')).not.toBeNull();
  });
});
