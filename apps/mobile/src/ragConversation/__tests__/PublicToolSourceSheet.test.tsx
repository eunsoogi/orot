import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { Linking } from 'react-native';
import { t } from '../../i18n';
import { ConversationToolEventSources } from '../ConversationToolEventSources';
import type { EvidenceReference } from '@orot/agent-runtime';
import { conversationToolEventFixtures } from '../testSupport/conversationToolEventFixtures';

const publicRef: EvidenceReference = {
  sourceKind: 'external_medical',
  sourceId: 'public-web',
  sourceRevision: 'retrieved:2035-01-01',
  evidenceId: 'synthetic-web',
  evidenceRevision: 'snapshot:2035-01-01',
  reviewState: 'unknown',
  effectiveTime: null,
  locator: {
    kind: 'public_web_search',
    sources: [
      {
        title: 'Synthetic public source',
        url: 'https://example.org/synthetic',
      },
    ],
  },
};
const event = {
  ...conversationToolEventFixtures[0]!,
  sources: [publicRef],
};
afterEach(() => jest.restoreAllMocks());

test('opens a cancellable source window before a retained lookup finishes, ignores duplicate taps and late result', async () => {
  let finish!: (value: EvidenceReference) => void;
  const held = new Promise<EvidenceReference>(resolve => {
    finish = resolve;
  });
  const resolve = jest.fn((_ref, _signal: AbortSignal) => held);
  const url = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  await render(
    <ConversationToolEventSources
      event={event}
      sessionId="synthetic"
      durableMessageId="turn"
      allowSourceActions
      resolveToolSource={resolve}
      onOpenSource={jest.fn()}
      onLinkError={jest.fn()}
    />,
  );
  const chip = screen.getByRole('button', { name: /원문 출처 확인/u });
  await fireEvent.press(chip);
  await fireEvent.press(chip);
  const sheet = await screen.findByTestId(
    'conversation-public-tool-source-sheet',
  );
  expect(within(sheet).getByRole('progressbar')).toBeTruthy();
  expect(within(sheet).queryByRole('link')).toBeNull();
  expect(resolve).toHaveBeenCalledTimes(1);
  await fireEvent.press(
    within(sheet).getByRole('button', { name: '현재 화면 닫기' }),
  );
  expect(resolve.mock.calls[0]![1].aborted).toBe(true);
  await act(async () => finish(publicRef));
  expect(
    screen.queryByTestId('conversation-public-tool-source-sheet'),
  ).toBeNull();
  expect(url).not.toHaveBeenCalled();
});

test.each(['revoked', 'changed', 'unsafe'] as const)(
  'external link still checks exact URL on explicit press: %s',
  async change => {
    const resolve = jest
      .fn(async (): Promise<EvidenceReference | undefined> =>
        change === 'revoked'
          ? undefined
          : {
              ...publicRef,
              locator: {
                ...(publicRef.locator as object),
                sources: [
                  {
                    title: 'Synthetic public source',
                    url:
                      change === 'unsafe'
                        ? 'http://example.org/unsafe'
                        : 'https://example.org/different',
                  },
                ],
              },
            },
      )
      .mockResolvedValueOnce(publicRef);
    const url = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await render(
      <ConversationToolEventSources
        event={event}
        sessionId="synthetic"
        durableMessageId="turn"
        allowSourceActions
        resolveToolSource={resolve}
        onOpenSource={jest.fn()}
        onLinkError={jest.fn()}
      />,
    );
    await fireEvent.press(
      screen.getByRole('button', { name: /원문 출처 확인/u }),
    );
    const link = await screen.findByRole('link', {
      name: /Synthetic public source/u,
    });
    expect(url).not.toHaveBeenCalled();
    await fireEvent.press(link);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /열지 않았어요/u,
    );
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(url).not.toHaveBeenCalled();
  },
);

test.each([
  ['public-web-search', '공개 웹 출처'],
  [
    'europe-pmc-publication-search',
    `${t('ragConversation.tool.sourceKind.europePmc')} · ${t('ragConversation.tool.sources')}`,
  ],
] as const)(
  'uses the accessible source title for %s',
  async (toolName, title) => {
    await render(
      <ConversationToolEventSources
        event={{ ...event, toolName }}
        sessionId="synthetic"
        durableMessageId="turn"
        allowSourceActions
        resolveToolSource={async () => undefined}
        onOpenSource={jest.fn()}
        onLinkError={jest.fn()}
      />,
    );
    await fireEvent.press(
      screen.getByRole('button', { name: /원문 출처 확인/u }),
    );
    expect(screen.getByRole('header', { name: title })).toBeTruthy();
  },
);
