import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { EvidenceReference } from '@orot/agent-runtime';
import { t } from '../../../i18n';
import { AiFeatureRoute } from '../AiFeatureRoute';
import { EvidenceSourceDetailScreen } from '../EvidenceSourceDetailScreen';
import { ConversationMessage as MockConversationMessage } from '../../../ragConversation/ConversationMessage';
import type { AiFeatureFlowScreenProps } from '../AiFeatureFlowScreenTypes';
import type { EvidenceSourceReadResult } from '../evidenceRegistry';
import { conversationToolEventFixtures } from '../../../ragConversation/testSupport/conversationToolEventFixtures';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../featureServices', () => ({
  createAiFeatureServices: () => mockServices,
}));
jest.mock('../AiFeatureFlowScreen', () => ({
  AiFeatureFlowScreen: (props: AiFeatureFlowScreenProps) => (
    <>
      {[mockOwner, undefined].map((sourceOwner, index) => (
        <MockConversationMessage
          key={index}
          message={{
            id: index,
            role: 'assistant',
            content: 'Synthetic answer',
            sourceOwner,
            citations: [mockReference],
          }}
          onOpenSource={props.onOpenSource}
          onLinkError={jest.fn()}
        />
      ))}
    </>
  ),
}));
const mockOwner = {
  sessionId: 'session',
  sessionVersion: 1,
  requestId: 'request',
  operationRunId: 'run',
};
const mockReference: EvidenceReference = {
  sourceKind: 'reviewed_memory',
  sourceId: 's1',
  sourceRevision: 'r1',
  evidenceId: 'e1',
  evidenceRevision: 'r1',
  reviewState: 'reviewed',
  effectiveTime: '2026-01-01',
  locator: { kind: 'local-evidence', token: 'e1' },
};
const mockServices = {
  conversationSessionOptions: () => undefined,
  readSource: jest.fn(async (): Promise<EvidenceSourceReadResult> => ({
    status: 'missing',
  })),
  readColdConversationSource: jest.fn(
    async (): Promise<EvidenceSourceReadResult> => ({ status: 'changed' }),
  ),
};
beforeEach(() => jest.clearAllMocks());

test('carries bubble owner through navigation to cold reader, then clears it for a live citation', async () => {
  await render(<AiFeatureRoute onBack={jest.fn()} />);
  await fireEvent.press(
    screen.getByTestId('rag-conversation-message-0-citation-0'),
  );
  expect(await screen.findByTestId('ai-feature-source-changed')).toBeTruthy();
  expect(mockServices.readColdConversationSource).toHaveBeenCalledWith(
    mockOwner,
    mockReference,
    expect.any(AbortSignal),
  );
  expect(mockServices.readSource).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('navigation-back'));
  await fireEvent.press(
    screen.getByTestId('rag-conversation-message-1-citation-0'),
  );
  expect(await screen.findByTestId('ai-feature-source-missing')).toBeTruthy();
  expect(mockServices.readSource).toHaveBeenCalledWith(
    mockReference,
    expect.any(AbortSignal),
  );
  expect(mockServices.readColdConversationSource).toHaveBeenCalledTimes(1);
});

test('owner without cold reader is unavailable and retry never falls back globally', async () => {
  const global = jest.fn();
  await render(
    <EvidenceSourceDetailScreen
      reference={mockReference}
      sourceOwner={mockOwner}
      readSource={global}
      onBack={jest.fn()}
    />,
  );
  expect(
    await screen.findByTestId('ai-feature-source-unavailable'),
  ).toBeTruthy();
  await fireEvent.press(screen.getByTestId('ai-feature-source-retry'));
  expect(
    await screen.findByTestId('ai-feature-source-unavailable'),
  ).toBeTruthy();
  expect(global).not.toHaveBeenCalled();
});

test('owner switch aborts the old read and rejects its delayed result', async () => {
  let finish!: (result: EvidenceSourceReadResult) => void;
  let oldSignal!: AbortSignal;
  const readCold = jest.fn((_owner, _reference, signal: AbortSignal) => {
    oldSignal = signal;
    return new Promise<EvidenceSourceReadResult>(resolve => {
      finish = resolve;
    });
  });
  const global = jest.fn();
  const view = await render(
    <EvidenceSourceDetailScreen
      reference={mockReference}
      sourceOwner={mockOwner}
      readSource={global}
      readColdSource={readCold}
      onBack={jest.fn()}
    />,
  );
  const old = oldSignal;
  const oldFinish = finish;
  readCold.mockResolvedValueOnce({ status: 'changed' });
  await view.rerender(
    <EvidenceSourceDetailScreen
      reference={mockReference}
      sourceOwner={{ ...mockOwner, requestId: 'new' }}
      readSource={global}
      readColdSource={readCold}
      onBack={jest.fn()}
    />,
  );
  expect(old.aborted).toBe(true);
  await act(async () => oldFinish({ status: 'missing' }));
  expect(screen.getByTestId('ai-feature-source-changed')).toBeTruthy();
  expect(screen.queryByTestId('ai-feature-source-missing')).toBeNull();
  expect(global).not.toHaveBeenCalled();
});

test('cold bubble disables global tool lookup and continues only its interrupted request', async () => {
  const global = jest.fn();
  const resume = jest.fn();
  const event = conversationToolEventFixtures[0]!;
  const message = {
    id: 9,
    role: 'assistant' as const,
    content: 'Interrupted',
    sourceOwner: mockOwner,
    toolMessageId: 'request',
    incomplete: true,
    coldResume: { attempt: 1 },
    toolEvents: [event],
  };
  const view = await render(
    <MockConversationMessage
      message={message}
      onOpenSource={jest.fn()}
      onLinkError={jest.fn()}
      resolveToolSource={global}
      toolSourceSessionId="session"
      onContinueCold={resume}
      coldResumeBusy
    />,
  );
  expect(screen.getByTestId('rag-conversation-cold-resume-9')).toBeDisabled();
  await fireEvent.press(
    screen.getByTestId(
      `rag-tool-event-${event.operationRunId}-${event.callId}-toggle`,
    ),
  );
  expect(
    screen.queryByRole('button', {
      name: new RegExp(`^${t('ragConversation.tool.openSource')}`),
    }),
  ).toBeNull();
  expect(global).not.toHaveBeenCalled();
  await view.rerender(
    <MockConversationMessage
      message={message}
      onOpenSource={jest.fn()}
      onLinkError={jest.fn()}
      onContinueCold={resume}
    />,
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-cold-resume-9'));
  expect(resume).toHaveBeenCalledWith('request');
  await view.rerender(
    <MockConversationMessage
      message={{ ...message, incomplete: false }}
      onOpenSource={jest.fn()}
      onLinkError={jest.fn()}
      onContinueCold={resume}
    />,
  );
  expect(screen.queryByTestId('rag-conversation-cold-resume-9')).toBeNull();
});
