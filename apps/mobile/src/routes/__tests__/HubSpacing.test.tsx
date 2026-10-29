import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { RecordsRecentSources } from '../RecordsRecentSources';
import { savedSource } from '../../recording/recordingScreenSupport';

jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));

/** Recent states inherit the page edge without an additional card inset. */
test.each(['loading', 'failed', 'ready'] as const)(
  'aligns the %s recent-source state with the shared page gutter',
  async recordingState => {
    await render(
      <RecordsRecentSources
        recordings={[]}
        recordingState={recordingState}
        onRetry={jest.fn()}
        onOpenSavedRecordings={jest.fn()}
      />,
    );
    const style = StyleSheet.flatten(
      screen.getByTestId('records-recent-sources').props.style,
    );
    expect(style.padding).toBeUndefined();
    expect(style.gap).toBe(16);
  },
);

test('populated rows use the same page edge and equal gaps while retaining readable touch targets', async () => {
  await render(
    <RecordsRecentSources
      recordings={[savedSource, { ...savedSource, id: 'second' }]}
      recordingState="ready"
      onRetry={jest.fn()}
      onOpenSavedRecordings={jest.fn()}
    />,
  );
  const row = screen.getByTestId('records-recent-source-' + savedSource.id);
  const style = StyleSheet.flatten(row.props.style);
  expect(style.minHeight).toBeGreaterThanOrEqual(44);
  expect(style.height).toBeUndefined();
  expect(StyleSheet.flatten(row.parent?.props.style).gap).toBe(16);
  expect(
    StyleSheet.flatten(screen.getByTestId('records-recent-sources').props.style)
      .padding,
  ).toBeUndefined();
});
