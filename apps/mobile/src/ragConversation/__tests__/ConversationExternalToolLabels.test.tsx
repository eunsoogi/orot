import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import type { ConversationToolEvent } from '@orot/agent-runtime';
import { ConversationToolEvents } from '../ConversationToolEvents';

test.each([
  ['public-web-search', '웹검색', '공개 웹 출처'],
  ['europe-pmc-publication-search', '의학 문헌 검색', '공개 의학 문헌'],
] as const)(
  'identifies the actual destination on the activity and source window: %s',
  async (name, activity, destination) => {
    const event: ConversationToolEvent = {
      version: 1,
      operationRunId: 'synthetic-run',
      callId: 'synthetic-call',
      order: 1,
      status: 'completed',
      toolName: name,
      inputSummary: { sourceKind: 'external_medical' },
      sources: [
        {
          sourceKind: 'external_medical',
          sourceId: 'opaque',
          sourceRevision: 'opaque',
          evidenceId: 'opaque',
          evidenceRevision: 'opaque',
        },
      ],
    };
    await render(
      <ConversationToolEvents
        events={[event]}
        messageId="synthetic"
        sessionId="synthetic"
        durableMessageId="synthetic"
        allowSourceActions
        onOpenSource={jest.fn()}
        onLinkError={jest.fn()}
        resolveToolSource={async () => undefined}
      />,
    );
    await fireEvent.press(
      screen.getByRole('button', { name: activity + ' 완료' }),
    );
    expect(screen.getByText(destination)).toBeTruthy();
    await fireEvent.press(
      screen.getByRole('button', { name: '원문 출처 확인 · ' + destination }),
    );
    const sheet = await screen.findByTestId(
      'conversation-public-tool-source-sheet',
    );
    const heading =
      name === 'public-web-search' ? destination : destination + ' · 출처';
    expect(within(sheet).getByRole('header', { name: heading })).toBeTruthy();
  },
);
