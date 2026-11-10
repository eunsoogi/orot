import { act, render, waitFor } from '@testing-library/react-native';
import { notifyLocalSourceDeleted } from '../../../storage/localDataClearEvents';
import {
  ConversationSessionsProvider,
  useConversationSessions,
} from '../../../ragConversation/ConversationSessionsContext';
import type { ConversationSessions } from '../../../ragConversation/conversationSessions';
import type { LocalHealthEvidenceInventory } from '../../../healthEvidence/localEvidenceRepository';
import { completeInventory, localData } from '../featureServiceFixtures';
import { readConversationAvailability } from '../readConversationAvailability';

jest.mock('../../../healthkit/autoSyncLocal', () => ({
  loadLocalHealthKitAutoSyncStatus: jest.fn(async () => null),
}));

const inventory: LocalHealthEvidenceInventory = {
  ...completeInventory,
  availableKinds: ['health_observation'],
  recordCount: 1,
};

async function mount() {
  let store!: ConversationSessions;
  function Capture() {
    store = useConversationSessions();
    return null;
  }
  await render(
    <ConversationSessionsProvider>
      <Capture />
    </ConversationSessionsProvider>,
  );
  const id = store.getSnapshot().activeId;
  const session = () => store.getSnapshot().sessions[0]!;
  const removeHealth = () =>
    notifyLocalSourceDeleted('healthkit', new Set(['removed-observation']));
  return { store, id, session, removeHealth };
}

test('withholds an obsolete inventory result when its read finishes after deletion', async () => {
  const { store, id, session, removeHealth } = await mount();
  const { data } = localData([]);
  Object.assign(data.manualHistory, { listEvidence: async () => [] });
  let resolve!: (value: LocalHealthEvidenceInventory) => void;
  const readInventory = jest.fn(
    () =>
      new Promise<LocalHealthEvidenceInventory>(done => {
        resolve = done;
      }),
  );
  Object.assign(data.repository, { readInventory });
  await act(async () => {
    store.setDraft(id, 'What health records can you see?');
    store.send(id, (_prompt, _history, signal) =>
      readConversationAvailability(data, signal!),
    );
  });
  await waitFor(() => expect(readInventory).toHaveBeenCalledTimes(1));
  await act(async () => removeHealth());
  await act(async () => resolve(inventory));
  await waitFor(() => expect(session().busy).toBe(false));
  expect(session().messages.filter(item => item.role === 'assistant')).toEqual(
    [],
  );
  expect(session().draft).toBe('What health records can you see?');
});

test('removes a previously displayed inventory answer and retains an independent answer', async () => {
  const { store, id, session, removeHealth } = await mount();
  const { data } = localData([]);
  Object.assign(data.manualHistory, { listEvidence: async () => [] });
  Object.assign(data.repository, { readInventory: async () => inventory });
  await act(async () => {
    store.setDraft(id, 'Hello');
    await store.send(id, async () => ({
      status: 'answer',
      answer: 'Independent greeting',
      citations: [],
      healthSources: [],
    }));
    store.setDraft(id, 'Which records are available?');
    await store.send(id, (_prompt, _history, signal) =>
      readConversationAvailability(data, signal!),
    );
  });
  expect(
    session().messages.some(item => item.content.includes('건강 측정')),
  ).toBe(true);
  await act(async () => removeHealth());
  expect(
    session()
      .messages.filter(item => item.role === 'assistant')
      .map(item => item.content),
  ).toEqual(['Independent greeting']);
});
