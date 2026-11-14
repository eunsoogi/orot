import { fireEvent, render, screen } from '@testing-library/react-native';
import { NativeModules } from 'react-native';
import { NativeReviewProbe } from '../src/encounterReview/NativeReviewProbe';

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: require('react-native').View,
  SafeAreaView: require('react-native').View,
}));
jest.mock('../src/recording/RecordingSelectionContext', () => ({
  RecordingSelectionProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));
jest.mock('../src/navigation', () => {
  const { View } = require('react-native');
  return {
    createNavigationController: () => ({}),
    NavigationRouteAdapter: ({
      children,
    }: {
      children: (actions: unknown) => React.ReactNode;
    }) => (
      <View testID="full-window-route">
        {children({ route: { name: 'recording-review' } })}
      </View>
    ),
  };
});
jest.mock('../src/routes/SavedRecordingsRoute', () => ({
  SavedRecordingsRoute: () => null,
}));
jest.mock('../src/routes/RecordingReviewRoute', () => {
  const { View } = require('react-native');
  return { RecordingReviewRoute: () => <View testID="review-route" /> };
});
jest.mock('../src/storage/secureDatabase', () => ({
  openLocalStorage: async () => ({
    get: async () => ({ sourceKind: 'audio_recording' }),
    sourceRecords: { delete: async () => undefined },
    list: async () => [],
  }),
}));
jest.mock('../src/agent/encounter/syntheticFixture', () => ({
  syntheticEncounterModel: () => ({
    model: { provider: { id: 'synthetic' } },
    calls: [],
  }),
}));
jest.mock('../src/encounterReview/service', () => ({
  createEncounterReviewService: () => ({
    diagnostics: {},
    restore: async () => ({ status: 'unavailable' }),
  }),
}));
jest.mock('../src/encounterReview/nativeDiagnostics', () => ({
  createNativeReviewDiagnostics: () => ({}),
  readNativeReviewReport: async () => ({ modelCalls: 0, records: [] }),
}));

// Geometry remains a native oracle; this contract guards diagnostic isolation and recovery.
test('diagnostics update in a modal while the full-window route stays mounted', async () => {
  NativeModules.SettingsManager = {
    settings: {
      OROT_REVIEW_FIXTURE:
        'test-persistence-00000000-0000-0000-0000-000000000000',
    },
  };
  const view = await render(<NativeReviewProbe />);
  expect(await screen.findByText('ready')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('encounter-probe-close'));
  const route = screen.getByTestId('full-window-route');
  expect(route.parent?.props.style).toEqual({ flex: 1 });
  expect(
    route.parent?.children.filter(
      child => typeof child !== 'string' && child.type !== 'Modal',
    ),
  ).toEqual([route]);
  expect(screen.queryByTestId('encounter-probe-report')).toBeNull();
  expect(screen.getByTestId('review-route')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('encounter-probe-tools'));
  await fireEvent.press(screen.getByTestId('encounter-probe-readback'));
  expect(
    await screen.findByText('{"readback":1,"modelCalls":0,"records":[]}'),
  ).toBeTruthy();
  await fireEvent.press(screen.getByTestId('encounter-probe-close'));
  expect(screen.getByTestId('full-window-route')).toBe(route);
  await fireEvent.press(screen.getByTestId('encounter-probe-tools'));
  await fireEvent.press(screen.getByTestId('encounter-probe-remove-source'));
  expect(await screen.findByText('removed')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('encounter-probe-cleanup'));
  expect(await screen.findByText('cleaned')).toBeTruthy();
  await view.unmount();
});
