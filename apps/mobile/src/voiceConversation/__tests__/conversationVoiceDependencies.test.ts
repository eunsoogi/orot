import { AppState } from 'react-native';
import {
  conversationVoiceDependencies,
  type ConversationVoiceProps,
  type SelectionBinding,
} from '../conversationVoiceDependencies';
import type { ConversationSessions } from '../../ragConversation/conversationSessionTypes';

test('a quarantined or removed session cannot retain voice ownership', () => {
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
  let sessions = [{ id: 1, quarantined: false }];
  const store = {
    getSnapshot: () => ({ activeId: 1, sessions }),
    photoDrafts: { get: () => ({ status: 'empty' }) },
  } as unknown as ConversationSessions;
  const latest = {
    current: {
      store,
      sessionId: 1,
      busy: false,
      photoPending: false,
      selectionRevision: 0,
      resolveSelectedAi: jest.fn(),
      onSend: jest.fn(),
    } as ConversationVoiceProps,
  };
  const selected = {
    current: {
      sessionId: 1,
      revision: 0,
      value: { provider: { id: 'p' } },
    } as SelectionBinding | null,
  };
  let systemCallActive = false;
  const deps = conversationVoiceDependencies({
    latest,
    isSystemCallActive: () => systemCallActive,
    selected,
    owned: { current: null },
    native: {} as never,
  });
  const identity = { sessionId: 1, providerId: 'p', turnId: 'one' };
  expect(deps.isCurrent(identity)).toBe(true);
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'inactive',
  });
  expect(deps.isCurrent(identity)).toBe(true);
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'background',
  });
  expect(deps.isCurrent(identity)).toBe(false);
  systemCallActive = true;
  expect(deps.isCurrent(identity)).toBe(true);
  selected.current!.revision = 1;
  expect(deps.isCurrent(identity)).toBe(false);
  selected.current!.revision = 0;
  sessions = [{ id: 1, quarantined: true }];
  expect(deps.isCurrent(identity)).toBe(false);
  sessions = [];
  expect(deps.isCurrent(identity)).toBe(false);
});

test.each([
  'completed',
  'cancelled',
  'stale',
  'broken-display',
  'aborted',
] as const)(
  'publishes only the current committed voice answer: %s',
  async outcome => {
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'active',
    });
    let finish!: (value: unknown) => void;
    const handle = {
      completion: new Promise(resolve => {
        finish = resolve;
      }),
      cancel: jest.fn(),
    };
    const store = {
      getSnapshot: () => ({ activeId: 1, sessions: [{ id: 1 }] }),
      photoDrafts: { get: () => ({ status: 'empty' }) },
      sendOwnedPrompt: jest.fn(() => handle),
    } as unknown as ConversationSessions;
    const latest = {
      current: {
        store,
        sessionId: 1,
        selectionRevision: 0,
        onSend: jest.fn(),
      } as unknown as ConversationVoiceProps,
    };
    const selected = {
      current: {
        sessionId: 1,
        revision: 0,
        value: { provider: { id: 'p' } },
      } as SelectionBinding | null,
    };
    const transcript = jest.fn();
    if (outcome === 'broken-display')
      transcript.mockImplementation(() => {
        throw new Error('display failed');
      });
    const deps = conversationVoiceDependencies({
      latest,
      selected,
      native: {} as never,
      owned: { current: null },
      transcript,
    });
    const signal = new AbortController();
    const pending = deps.submit(
      { sessionId: 1, providerId: 'p', turnId: 'one' },
      'synthetic user',
      signal.signal,
    );
    expect(transcript.mock.calls).toEqual([
      [{ id: 'one:user', role: 'user', text: 'synthetic user' }],
    ]);
    if (outcome === 'stale')
      latest.current = { ...latest.current, selectionRevision: 1 };
    if (outcome === 'aborted') signal.abort();
    finish({
      status: outcome === 'cancelled' ? 'cancelled' : 'completed',
      answer: 'synthetic answer',
    });
    if (outcome === 'completed' || outcome === 'broken-display') {
      await expect(pending).resolves.toBe('synthetic answer');
      expect(transcript).toHaveBeenLastCalledWith({
        id: 'one:assistant',
        role: 'assistant',
        text: 'synthetic answer',
      });
    } else {
      await expect(pending).rejects.toThrow('Voice answer unavailable');
      expect(transcript).toHaveBeenCalledTimes(1);
    }
  },
);
