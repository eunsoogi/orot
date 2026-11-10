import { act, render } from '@testing-library/react-native';
import type { EvidenceReference } from '@orot/agent-runtime';
import { notifyLocalSourceDeleted } from '../../storage/localDataClearEvents';
import {
  ConversationSessionsProvider,
  useConversationSessions,
} from '../ConversationSessionsContext';
import type { ConversationSessions } from '../conversationSessions';
import type { ConversationSender } from '../conversationSessionTypes';
import type { RagConversationOutcome } from '../outcome';

const health: EvidenceReference = {
  sourceKind: 'personal_record',
  sourceId: 'synthetic-health',
  sourceRevision: 'one',
  evidenceId: 'synthetic-health',
  evidenceRevision: 'one',
  locator: {
    kind: 'local_record',
    recordKind: 'health_observation',
    recordId: 'synthetic-health',
  },
  effectiveTime: null,
  reviewState: 'unknown',
};

async function mountSession() {
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
  return { store, id, session };
}

function pendingAnswer() {
  let signal: AbortSignal | undefined;
  let stream: Parameters<ConversationSender>[3];
  let finish!: (value: RagConversationOutcome) => void;
  const result = new Promise<RagConversationOutcome>(resolve => {
    finish = resolve;
  });
  const send: ConversationSender = async (
    _question,
    _history,
    current,
    observer,
  ) => {
    signal = current;
    stream = observer;
    return result;
  };
  return {
    send,
    finish,
    get signal() {
      return signal;
    },
    get stream() {
      return stream;
    },
  };
}

test.each([
  ['known independent', [] as const],
  ['missing source metadata', undefined],
] as const)(
  'preserves a pending request and drafts, then checks its %s answer',
  async (_scope, healthSources) => {
    const { store, id, session } = await mountSession();
    const pending = pendingAnswer();
    await act(async () => {
      store.setDraft(id, 'unrelated prompt');
      store.send(id, pending.send);
      store.setDraft(id, 'newer draft');
    });
    await act(async () => notifyLocalSourceDeleted('healthkit'));
    expect(pending.signal?.aborted).toBe(false);
    expect(session()).toMatchObject({ busy: true, draft: 'newer draft' });
    await act(async () =>
      pending.finish({
        status: 'answer',
        answer: 'unrelated answer',
        citations: [],
        healthSources,
      }),
    );
    expect(session().messages.map(item => item.content)).toEqual(
      healthSources
        ? ['unrelated prompt', 'unrelated answer']
        : ['unrelated prompt'],
    );
    expect(session().draft).toBe('newer draft');
  },
);

test('withholds health-dependent saved and pending answer bodies across deletion', async () => {
  const { store, id, session } = await mountSession();
  await act(async () => {
    store.setDraft(id, 'health question');
    await store.send(id, async () => ({
      status: 'answer',
      answer: 'affected answer',
      citations: [health],
    }));
  });
  const pending = pendingAnswer();
  await act(async () => {
    store.setDraft(id, 'follow-up');
    store.send(id, pending.send);
  });
  await act(async () =>
    notifyLocalSourceDeleted('healthkit', new Set(['synthetic-health'])),
  );
  expect(session().messages.map(item => item.content)).toEqual([
    'health question',
    'follow-up',
  ]);
  await act(async () => {
    pending.stream?.onTaskStreamEvent?.({
      type: 'text_snapshot',
      text: 'affected stream',
    });
  });
  expect(session().pendingMessage?.content).toBe('');
  await act(async () =>
    pending.finish({
      status: 'answer',
      answer: 'late affected answer',
      citations: [health],
    }),
  );
  expect(
    session().messages.some(item => item.content === 'late affected answer'),
  ).toBe(false);
  expect(session().draft).toBe('follow-up');
});

test('keeps a completed health answer with a different exact record identity', async () => {
  const { store, id, session } = await mountSession();
  await act(async () => {
    store.setDraft(id, 'other health question');
    await store.send(id, async () => ({
      status: 'answer',
      answer: 'other health answer',
      citations: [health],
    }));
  });
  await act(async () =>
    notifyLocalSourceDeleted('healthkit', new Set(['different-record'])),
  );
  expect(session().messages.map(item => item.content)).toContain(
    'other health answer',
  );
});
