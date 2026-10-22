import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Appearance, Linking } from 'react-native';
import { ConversationSources } from '../../ragConversation/ConversationSources';
import { EvidenceLinks } from '../../diseaseHypotheses/DiseaseEvidenceLinks';
import {
  webReference,
  publicResponse,
} from '../../aiFeatures/integration/testSupport/publicWebEvidenceTestSupport';

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

test.each(['light', 'dark'] as const)(
  'keeps every actual web source clickable in conversation under %s appearance',
  async appearance => {
    jest.spyOn(Appearance, 'getColorScheme').mockReturnValue(appearance);
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const local = jest.fn();
    await render(
      <ConversationSources
        references={[webReference]}
        onOpenSource={local}
        onLinkError={jest.fn()}
      />,
    );
    expect(screen.queryByText(/Europe PMC/u)).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(2);
    for (const source of publicResponse.citations) {
      await fireEvent.press(
        screen.getByLabelText(`웹 출처 열기 · ${source.title}`),
      );
      expect(open).toHaveBeenCalledWith(source.url);
    }
    expect(local).not.toHaveBeenCalled();
  },
);

test('summary citations retain all source links after JSON serialization', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  const restored = JSON.parse(JSON.stringify(webReference));
  await render(
    <EvidenceLinks
      title="뒷받침하는 근거"
      references={[restored]}
      onOpenSource={jest.fn()}
    />,
  );
  expect(screen.getAllByRole('link')).toHaveLength(2);
  await fireEvent.press(
    screen.getByLabelText(
      `웹 출처 열기 · ${publicResponse.citations[1]!.title}`,
    ),
  );
  expect(open).toHaveBeenCalledWith(publicResponse.citations[1]!.url);
});

test.each([
  'file:///private/source',
  'javascript:alert(1)',
  'https://user:secret@example.org',
])('never opens an unsafe saved source %s', async url => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  const error = jest.fn();
  await render(
    <ConversationSources
      references={[
        {
          ...webReference,
          locator: {
            kind: 'public_web_search',
            sources: [{ url, title: 'Unsafe' }],
          },
        },
      ]}
      onOpenSource={jest.fn()}
      onLinkError={error}
    />,
  );
  await fireEvent.press(screen.getByLabelText('웹 출처 확인 불가'));
  expect(error).toHaveBeenCalledTimes(1);
  expect(open).not.toHaveBeenCalled();
});

test('reports an operating-system link failure without relabelling the source as a paper', async () => {
  jest
    .spyOn(Linking, 'openURL')
    .mockRejectedValue(new Error('Synthetic unavailable browser'));
  const error = jest.fn();
  await render(
    <ConversationSources
      references={[webReference]}
      onOpenSource={jest.fn()}
      onLinkError={error}
    />,
  );
  await fireEvent.press(screen.getAllByRole('link')[0]!);
  await waitFor(() => expect(error).toHaveBeenCalledTimes(1));
  expect(screen.queryByText(/Europe PMC/u)).toBeNull();
});
