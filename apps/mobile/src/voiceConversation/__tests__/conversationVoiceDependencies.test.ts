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
  const deps = conversationVoiceDependencies({
    latest,
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
  sessions = [{ id: 1, quarantined: true }];
  expect(deps.isCurrent(identity)).toBe(false);
  sessions = [];
  expect(deps.isCurrent(identity)).toBe(false);
});
