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
  expect(
    screen.getByText(/Europe PMC · 공개 의학 문헌 · 조회 2026-10-11/),
  ).toBeTruthy();
  await fireEvent.press(
    screen.getByLabelText(
      '원문 근거 열기 · Synthetic literature title · 2026-01-01',
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
