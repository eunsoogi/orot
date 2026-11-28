import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { hubSpacing } from '../../layout/hubSpacing';
import { createNavigationController } from '../../navigation/navigationController';
import type { AppNavigationRoute } from '../appNavigationRoute';
import {
  recentRouteProps,
  renderRecords,
} from '../testSupport/recentRecordsRouteTestSupport';
import { RecordsRecentSources } from '../RecordsRecentSources';
import { savedSource } from '../../recording/recordingScreenSupport';

jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

/** Recent states inherit the page edge without an additional card inset. */
test.each(['loading', 'failed', 'ready'] as const)(
  'aligns the %s recent-source state with the shared page gutter',
  async recordingState => {
    await render(
      <RecordsRecentSources
        recordings={[]}
        recordingState={recordingState}
        documents={[]}
        documentsState="ready"
        documentsError={null}
        documentsOpening={false}
        onRetryRecordings={jest.fn()}
        onRetryDocuments={jest.fn()}
        onOpenMedicalDocument={jest.fn()}
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
      documents={[]}
      documentsState="ready"
      documentsError={null}
      documentsOpening={false}
      onRetryRecordings={jest.fn()}
      onRetryDocuments={jest.fn()}
      onOpenMedicalDocument={jest.fn()}
      onOpenSavedRecordings={jest.fn()}
    />,
  );
  const row = screen.getByTestId('records-recent-source-' + savedSource.id);
  const style = StyleSheet.flatten(row.props.style);
  expect(style.minHeight).toBeGreaterThanOrEqual(44);
  expect(style.height).toBeUndefined();
  expect(StyleSheet.flatten(row.parent?.props.style).gap).toBe(6);
  expect(
    StyleSheet.flatten(screen.getByTestId('records-recent-sources').props.style)
      .padding,
  ).toBeUndefined();
});

test('uses the same compact boundary gap between the page heading, timeline, and library', async () => {
  await renderRecords(
    createNavigationController<AppNavigationRoute>('root'),
    recentRouteProps(),
  );
  expect(screen.getByTestId('records-hub-header')).toBeTruthy();
  expect(screen.getByTestId('records-layout')).toHaveStyle({
    paddingTop: hubSpacing.top,
    gap: 22,
  });
  expect(screen.getByTestId('records-material-directory')).toBeVisible();
  expect(screen.getByTestId('records-document-import')).toBeVisible();
});
