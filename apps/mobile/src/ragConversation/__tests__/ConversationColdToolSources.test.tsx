import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { EvidenceReference } from '@orot/agent-runtime';
import { ConversationMessage } from '../ConversationMessage';
import { conversationToolEventFixtures } from '../testSupport/conversationToolEventFixtures';
import { t } from '../../i18n';
import type { ResolveColdConversationToolSource } from '../../aiFeatures/integration/coldConversationSourceResolvers';

const owner = {
  sessionId: 'session',
  sessionVersion: 0,
  requestId: 'request',
  operationRunId: 'synthetic-run',
};
const event = conversationToolEventFixtures[0]!;
const alias: EvidenceReference = {
  ...event.sources[0]!,
  locator: { kind: 'local-evidence', token: 'e1' },
  effectiveTime: null,
  reviewState: 'unknown',
};
const message = {
  id: 1,
  role: 'assistant' as const,
  content: '',
  sourceOwner: owner,
  toolMessageId: owner.requestId,
  toolEvents: [event],
};
async function expand() {
  await fireEvent.press(
    screen.getByTestId(
      `rag-tool-event-${event.operationRunId}-${event.callId}-toggle`,
    ),
  );
}
const opener = () =>
  screen.getByRole('button', {
    name: new RegExp(`^${t('ragConversation.tool.openSource')}`),
  });

test('cold tool click passes exact owner and call scope, then navigates with the same owner', async () => {
  const resolve = jest.fn<
    ReturnType<ResolveColdConversationToolSource>,
    Parameters<ResolveColdConversationToolSource>
  >(async () => alias);
  const global = jest.fn();
  const open = jest.fn();
  await render(
    <ConversationMessage
      message={message}
      onOpenSource={open}
      onLinkError={jest.fn()}
      resolveColdToolSource={resolve}
      resolveToolSource={global}
      toolSourceSessionId={owner.sessionId}
    />,
  );
  await expand();
  await fireEvent.press(opener());
  expect(resolve).toHaveBeenCalledWith(
    owner,
    event.sources[0],
    expect.any(AbortSignal),
    {
      sessionId: owner.sessionId,
      operationRunId: event.operationRunId,
      callId: event.callId,
    },
  );
  expect(open).toHaveBeenCalledWith(alias, owner);
  expect(global).not.toHaveBeenCalled();
});

test.each(['request', 'version', 'source'] as const)(
  'late tool opener is aborted after %s identity replacement',
  async change => {
    let complete!: (value: EvidenceReference) => void;
    let signal!: AbortSignal;
    const resolve: ResolveColdConversationToolSource = async (
      _owner,
      _source,
      currentSignal,
    ) => {
      signal = currentSignal;
      return new Promise(done => {
        complete = done;
      });
    };
    const open = jest.fn();
    const props = {
      onOpenSource: open,
      onLinkError: jest.fn(),
      resolveColdToolSource: resolve,
      toolSourceSessionId: owner.sessionId,
    };
    const view = await render(
      <ConversationMessage {...props} message={message} />,
    );
    await expand();
    await fireEvent.press(opener());
    const next =
      change === 'source'
        ? {
            ...message,
            toolEvents: [
              {
                ...event,
                sources: [
                  { ...event.sources[0]!, evidenceRevision: 'different' },
                ],
              },
            ],
          }
        : {
            ...message,
            sourceOwner: {
              ...owner,
              ...(change === 'request'
                ? { requestId: 'other-request' }
                : { sessionVersion: 1 }),
            },
          };
    await view.rerender(<ConversationMessage {...props} message={next} />);
    expect(signal.aborted).toBe(true);
    await act(async () => complete(alias));
    expect(open).not.toHaveBeenCalled();
  },
);

test('missing cold resolver never offers a global tool source action', async () => {
  const global = jest.fn();
  await render(
    <ConversationMessage
      message={message}
      onOpenSource={jest.fn()}
      onLinkError={jest.fn()}
      resolveToolSource={global}
      toolSourceSessionId={owner.sessionId}
    />,
  );
  await expand();
  expect(
    screen.queryByRole('button', {
      name: new RegExp(`^${t('ragConversation.tool.openSource')}`),
    }),
  ).toBeNull();
  expect(global).not.toHaveBeenCalled();
});
