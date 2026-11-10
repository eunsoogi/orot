import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Linking } from 'react-native';
import type { EvidenceReference } from '@orot/agent-runtime';
import { ConversationMessage } from '../ConversationMessage';
import type { ResolveConversationToolSource } from '../ConversationToolEventSources';
import { conversationToolEventFixtures } from '../testSupport/conversationToolEventFixtures';

const event = conversationToolEventFixtures[0]!;
const localReference: EvidenceReference = {
  sourceKind: 'personal_record',
  sourceId: 'restored-record',
  sourceRevision: 'record-v2',
  evidenceId: 'restored-span',
  evidenceRevision: 'span-v2',
  reviewState: 'unknown',
  effectiveTime: '2026-01-01',
  locator: { title: 'Saved health record' },
};
const publicReference: EvidenceReference = {
  sourceKind: 'external_medical',
  sourceId: 'public-web',
  sourceRevision: 'retrieved:2026-11-06',
  evidenceId: 'web-result',
  evidenceRevision: 'snapshot:2026-11-06:1',
  reviewState: 'unknown',
  effectiveTime: '2026-11-06',
  locator: {
    kind: 'public_web_search',
    sources: [
      { title: 'First article', url: 'https://example.org/first' },
      { title: 'Second article', url: 'https://example.org/second' },
    ],
  },
};

afterEach(() => jest.restoreAllMocks());

function eventToggleId() {
  return `rag-tool-event-${event.operationRunId}-${event.callId}-toggle`;
}

test('opens a local source only after resolving it with the durable session and call scope', async () => {
  const resolveToolSource: ResolveConversationToolSource = jest.fn(
    async () => localReference,
  );
  const onOpenSource = jest.fn();
  await render(
    <ConversationMessage
      message={{
        id: 1,
        role: 'assistant',
        content: '',
        toolMessageId: 'durable-turn',
        toolEvents: [event],
      }}
      onLinkError={jest.fn()}
      onOpenSource={onOpenSource}
      resolveToolSource={resolveToolSource}
      toolSourceSessionId="durable-session"
    />,
  );

  await fireEvent.press(screen.getByTestId(eventToggleId()));
  fireEvent.press(screen.getByRole('button', { name: /원문 출처 확인/u }));
  await waitFor(() =>
    expect(onOpenSource).toHaveBeenCalledWith(localReference),
  );
  expect(resolveToolSource).toHaveBeenCalledWith(
    event.sources[0],
    expect.any(AbortSignal),
    {
      sessionId: 'durable-session',
      operationRunId: event.operationRunId,
      callId: event.callId,
    },
  );
});

test('re-resolves each selected public source before opening its URL', async () => {
  const publicEvent = {
    ...event,
    inputSummary: { sourceKind: 'external_medical' as const },
    sources: [
      {
        sourceKind: 'external_medical' as const,
        sourceId: 'public-web',
        sourceRevision: 'retrieved:2026-11-06',
        evidenceId: 'web-result',
        evidenceRevision: 'snapshot:2026-11-06:1',
      },
    ],
  };
  const resolveToolSource: ResolveConversationToolSource = jest.fn(
    async () => publicReference,
  );
  const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  await render(
    <ConversationMessage
      message={{
        id: 1,
        role: 'assistant',
        content: '',
        toolMessageId: 'durable-turn',
        toolEvents: [publicEvent],
      }}
      onLinkError={jest.fn()}
      onOpenSource={jest.fn()}
      resolveToolSource={resolveToolSource}
      toolSourceSessionId="durable-session"
    />,
  );

  await fireEvent.press(screen.getByTestId(eventToggleId()));
  fireEvent.press(screen.getByRole('button', { name: /원문 출처 확인/u }));
  const firstLink = await screen.findByRole('link', {
    name: '웹 출처 열기 · First article',
  });
  fireEvent.press(firstLink);
  await waitFor(() =>
    expect(openURL).toHaveBeenCalledWith('https://example.org/first'),
  );
  expect(resolveToolSource).toHaveBeenCalledTimes(2);
});

test('does not expose tool-source actions in a compact history preview', async () => {
  await render(
    <ConversationMessage
      message={{
        id: 1,
        role: 'assistant',
        content: '',
        toolMessageId: 'durable-turn',
        toolEvents: [event],
      }}
      onLinkError={jest.fn()}
      onOpenSource={jest.fn()}
      resolveToolSource={jest.fn(async () => localReference)}
      showCitations={false}
      toolSourceSessionId="durable-session"
    />,
  );

  await fireEvent.press(screen.getByTestId(eventToggleId()));
  expect(screen.queryByRole('button', { name: /원문 출처 확인/u })).toBeNull();
});

test('aborts late source resolution when the active conversation changes', async () => {
  let finish!: (value: EvidenceReference | undefined) => void;
  let sourceSignal: AbortSignal | undefined;
  const pending = new Promise<EvidenceReference | undefined>(resolve => {
    finish = resolve;
  });
  const resolveToolSource: ResolveConversationToolSource = jest.fn(
    (_source, signal, _scope) => {
      sourceSignal = signal;
      return pending;
    },
  );
  const onOpenSource = jest.fn();
  const firstMessage = {
    id: 1,
    role: 'assistant' as const,
    content: '',
    toolMessageId: 'durable-turn-one',
    toolEvents: [event],
  };
  const view = await render(
    <ConversationMessage
      message={firstMessage}
      onLinkError={jest.fn()}
      onOpenSource={onOpenSource}
      resolveToolSource={resolveToolSource}
      toolSourceSessionId="durable-session-one"
    />,
  );

  await fireEvent.press(screen.getByTestId(eventToggleId()));
  await fireEvent.press(
    screen.getByRole('button', { name: /원문 출처 확인/u }),
  );
  await waitFor(() => expect(resolveToolSource).toHaveBeenCalledTimes(1));
  if (!sourceSignal) throw new Error('Expected a source-validation signal.');
  const signal = sourceSignal;
  await act(async () => {
    view.rerender(
      <ConversationMessage
        message={{ ...firstMessage, toolMessageId: 'durable-turn-two' }}
        onLinkError={jest.fn()}
        onOpenSource={onOpenSource}
        resolveToolSource={resolveToolSource}
        toolSourceSessionId="durable-session-two"
      />,
    );
  });

  await waitFor(() => expect(signal.aborted).toBe(true));
  expect(
    screen.getByTestId(eventToggleId()).props.accessibilityState.expanded,
  ).toBe(false);
  await act(async () => {
    finish(localReference);
    await Promise.resolve();
  });
  expect(onOpenSource).not.toHaveBeenCalled();
});
