import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Linking } from 'react-native';
import type { EvidenceReference } from '@orot/agent-runtime';
import { ConversationMessage } from '../ConversationMessage';

const reference: EvidenceReference = {
  sourceKind: 'external_medical',
  sourceId: 'europe-pmc',
  sourceRevision: 'retrieved:2026-10-11',
  evidenceId: 'MED:123',
  evidenceRevision: '1',
  reviewState: 'unknown',
  effectiveTime: '2026-01-01',
  locator: {
    title: 'Synthetic literature title',
    originalUrl: 'https://europepmc.org/article/MED/123',
    retrievedAt: '2026-10-11T00:00:00Z',
  },
};

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

test.each([
  { content: '저장된 기록을 바탕으로 한 답변이에요.' },
  { content: '', activity: '기록에서 근거를 찾고 있어요.', streaming: true },
])(
  'does not reserve an empty citation row below an uncited message',
  async message => {
    await render(
      <ConversationMessage
        message={{ id: 1, role: 'assistant', ...message }}
        onOpenSource={jest.fn()}
        onLinkError={jest.fn()}
      />,
    );
    expect(screen.queryByTestId('rag-conversation-sources')).toBeNull();
  },
);

test('shows publication provenance and opens only its validated canonical article link', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  const onOpenSource = jest.fn();
  await render(
    <ConversationMessage
      message={{
        id: 1,
        role: 'assistant',
        content: '답변',
        citations: [reference],
      }}
      onOpenSource={onOpenSource}
      onLinkError={jest.fn()}
    />,
  );
  // Native production verification needs the final answer body apart from its citation controls.
  expect(screen.getByTestId('rag-conversation-answer-body')).toHaveTextContent(
    '답변',
  );
  expect(screen.getByText('Europe PMC · 조회 2026-10-11')).toBeTruthy();
  expect(
    screen.getByTestId('rag-conversation-sources').props
      .keyboardShouldPersistTaps,
  ).toBe('handled');
  await fireEvent.press(
    screen.getByLabelText(
      /원문 근거 열기 · Synthetic literature title · Europe PMC · 공개 의학 문헌/u,
    ),
  );
  expect(open).toHaveBeenCalledWith('https://europepmc.org/article/MED/123');
  expect(onOpenSource).not.toHaveBeenCalled();
});

test.each([
  'https://example.com/article/MED/123',
  'https://europepmc.org/article/MED/123',
])('reports unsafe or failed article opening for %s', async url => {
  const open = jest
    .spyOn(Linking, 'openURL')
    .mockRejectedValue(new Error('No browser'));
  const error = jest.fn();
  await render(
    <ConversationMessage
      message={{
        id: 1,
        role: 'assistant',
        content: '답변',
        citations: [{ ...reference, locator: { originalUrl: url } }],
      }}
      onOpenSource={jest.fn()}
      onLinkError={error}
    />,
  );
  await fireEvent.press(screen.getByLabelText(/원문 근거 열기/));
  await waitFor(() => expect(error).toHaveBeenCalledTimes(1));
  expect(open).toHaveBeenCalledTimes(url.includes('example.com') ? 0 : 1);
});
