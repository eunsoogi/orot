import { render, screen, within } from '@testing-library/react-native';
import { AppState, StyleSheet } from 'react-native';
import { formatDateTime, t } from '../../i18n';
import { SavedMemoryDetail } from '../SavedMemoryDetail';
import { SavedMemoryContent } from '../SavedMemoryContent';
import type { AgentSavedMemory } from '../unifiedSavedMemories';

const memory: AgentSavedMemory = {
  id: 'synthetic-historical',
  kind: 'reviewed_interaction',
  createdAt: Date.UTC(2026, 0, 17, 10, 20),
  text:
    'Synthetic saved first paragraph.\n\n' +
    'A long second paragraph. '.repeat(28).trim(),
  historicalSnapshot: true,
  provenance: {
    reviewState: 'user_confirmed',
    sourceIds: ['synthetic-source'],
  },
};

beforeEach(() => {
  AppState.currentState = 'active';
  jest.mocked(AppState.addEventListener).mockReturnValue({ remove: jest.fn() });
});
afterEach(() => jest.restoreAllMocks());

test.each([
  { width: 320, fontScale: 1, direction: 'row', wrapping: 'wrap' },
  { width: 850, fontScale: 1, direction: 'row', wrapping: 'wrap' },
  { width: 850, fontScale: 2, direction: 'column', wrapping: 'nowrap' },
])(
  'keeps one exact reading column with wrap-safe metadata at $width pt and text scale $fontScale',
  async ({ width, fontScale, direction, wrapping }) => {
    jest.spyOn(require('react-native'), 'useWindowDimensions').mockReturnValue({
      width,
      height: 820,
      scale: 2,
      fontScale,
    });
    // The reader intentionally does not accept a supplied historical row;
    // its separate SQLite suite opens it through real selected-detail ownership.
    await render(<SavedMemoryContent memory={memory} />);
    expect(screen.getByRole('header')).toHaveTextContent(
      t('savedMemory.metadataTitle'),
    );
    const body = screen.getByTestId('saved-memory-verbatim');
    expect(body.props.children).toBe(memory.text);
    expect(body.props.selectable).toBe(false);
    expect(body.props.numberOfLines).toBeUndefined();
    expect(body.props.allowFontScaling).not.toBe(false);
    expect(body.props.maxFontSizeMultiplier).toBeUndefined();
    expect(StyleSheet.flatten(body.props.style)).toMatchObject({
      fontSize: 19,
      lineHeight: 31,
    });
    expect(
      screen.getByTestId('saved-memory-historical-context'),
    ).toHaveTextContent(t('savedMemory.historicalSnapshot'));
    const metadata = within(screen.getByTestId('saved-memory-metadata'));
    expect(
      metadata.getByText(t('savedMemory.reviewedInteraction')),
    ).toBeVisible();
    expect(metadata.getByText(t('savedMemory.confirmed'))).toBeVisible();
    expect(
      metadata.getByText(
        t('savedMemory.savedAt', {
          date: formatDateTime(new Date(memory.createdAt)),
        }),
      ),
    ).toBeVisible();
    expect(
      metadata.queryByText(t('savedMemory.sourceCount', { count: 1 })),
    ).toBeNull();
    expect(
      StyleSheet.flatten(
        metadata.getByTestId('saved-memory-metadata-groups').props.style,
      ),
    ).toMatchObject({
      flexDirection: direction,
      flexWrap: wrapping,
    });
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  },
);

test('the native detail shell keeps a centered bounded column and Records-like heading', async () => {
  await render(
    <SavedMemoryDetail
      memoryId={memory.id}
      load={async () => [{ ...memory, historicalSnapshot: undefined }]}
    />,
  );
  await screen.findByTestId('saved-memory-verbatim');
  expect(
    StyleSheet.flatten(screen.getByTestId('saved-memory-detail').props.style),
  ).toMatchObject({
    width: '100%',
    alignSelf: 'center',
    maxWidth: 736,
    paddingHorizontal: 20,
  });
  const title = screen.getByRole('header', {
    name: t('savedMemory.detailTitle'),
  });
  expect(StyleSheet.flatten(title.props.style)).toMatchObject({
    fontSize: 30,
    lineHeight: 39,
  });
});
