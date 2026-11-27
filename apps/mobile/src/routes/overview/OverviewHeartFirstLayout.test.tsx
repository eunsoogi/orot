import { fireEvent, render, screen } from '@testing-library/react-native';
import { AppState, NativeModules } from 'react-native';
import { OverviewHeartPanel } from './OverviewHeartPanel';
import { setup } from './testSupport/overviewWorkoutCardHarness';

let mockFocused = true;
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => mockFocused,
}));
jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  isCurrentLocalAgentMemoryDatabase: jest.fn(),
}));
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));

const feature = 'overview_heart_first_layout';
const layout = { nativeEvent: { lines: [{ width: 4, height: 8 }] } };
const metric = {
  metric: 'heartRate',
  unit: 'count/min',
  source: 'Synthetic source',
  latest: { date: '2035-01-14', value: 74.9 },
  measuredAt: null,
  timeZone: 'Asia/Seoul',
  days: [],
  comparison: null,
} as const;
const panel = (ready: boolean) => (
  <OverviewHeartPanel
    width={304}
    state={ready ? 'ready' : 'loading'}
    metrics={ready ? { heartRate: metric } : {}}
  />
);

test.each([false, true])(
  'first valid focused text-layout is bounded, never inferred from available data (opt-in %s)',
  async enabled => {
    const lane = await setup();
    const held = lane.holdSecondProbe();
    const beforePhase = AppState.currentState;
    const previous = NativeModules.OrotProviderDiagnostics;
    AppState.currentState = 'active';
    mockFocused = true;
    const report = jest.fn();
    NativeModules.OrotProviderDiagnostics = { enabled, report };
    const emitted = () =>
      report.mock.calls.filter(([kind]) => kind === feature);
    const initial = await render(panel(false));
    const workout = () =>
      screen.getByTestId('overview-workout-heart-rate-result');
    try {
      await held.entered;
      await fireEvent(workout(), 'textLayout', layout);
      expect(emitted()).toEqual([]);
      await initial.rerender(panel(true));
      const ordinary = () => screen.getByText('74 BPM');
      expect(ordinary()).toBeVisible();
      expect(emitted()).toEqual([]);
      const first = ordinary().props.onTextLayout;
      expect(typeof first).toBe(enabled ? 'function' : 'undefined');
      await fireEvent(ordinary(), 'textLayout', { nativeEvent: { lines: [] } });
      expect(emitted()).toEqual([]);
      await fireEvent(ordinary(), 'textLayout', layout);
      await fireEvent(ordinary(), 'textLayout', layout);
      AppState.currentState = 'background';
      await fireEvent(workout(), 'textLayout', layout);
      AppState.currentState = 'active';
      held.release(true);
      expect(await screen.findByText('120 BPM')).toBeVisible();
      expect(emitted()).toEqual(
        enabled ? [[feature, 'ordinary', 'laid_out']] : [],
      );
      AppState.currentState = 'background';
      await fireEvent(workout(), 'textLayout', layout);
      expect(emitted()).toEqual(
        enabled ? [[feature, 'ordinary', 'laid_out']] : [],
      );
      AppState.currentState = 'active';
      await fireEvent(workout(), 'textLayout', layout);
      await fireEvent(workout(), 'textLayout', layout);
      const pair = [
        [feature, 'ordinary', 'laid_out'],
        [feature, 'workout', 'laid_out'],
      ];
      expect(emitted()).toEqual(enabled ? pair : []);

      mockFocused = false;
      await initial.rerender(panel(true));
      first?.(layout);
      mockFocused = true;
      await initial.rerender(panel(true));
      first?.(layout);
      expect(emitted()).toEqual(enabled ? pair : []);
      await fireEvent(ordinary(), 'textLayout', layout);
      expect(emitted()).toEqual(enabled ? [...pair, pair[0]] : []);
    } finally {
      held.release(false);
      await initial.unmount();
      lane.close();
      AppState.currentState = beforePhase;
      NativeModules.OrotProviderDiagnostics = previous;
      mockFocused = true;
    }
  },
);
