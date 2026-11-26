import { act, render, screen, waitFor } from '@testing-library/react-native';
import { NavigationContext } from '@react-navigation/native';
import type { ContextType } from 'react';
import { t } from '../../i18n';
import { OverviewHeartPanel } from './OverviewHeartPanel';
import { resultFor, setup } from './testSupport/overviewWorkoutCardHarness';

jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  isCurrentLocalAgentMemoryDatabase: jest.fn(),
}));
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));

test('the remounted Overview heart panel is pending while the current foreground admission has not happened', async () => {
  const lane = await setup();
  try {
    const nav = {
      isFocused: () => true,
      addListener: () => () => {},
    } as unknown as NonNullable<ContextType<typeof NavigationContext>>;
    const panel = () => (
      <NavigationContext.Provider value={nav}>
        <OverviewHeartPanel width={320} metrics={{}} state="ready" />
      </NavigationContext.Provider>
    );
    const first = await render(panel());
    const result = () =>
      screen.getByTestId('overview-workout-heart-rate-result');
    await waitFor(() => expect(result()).toHaveTextContent('120 BPM'));
    await first.unmount();
    await act(() => lane.transition('inactive'));
    const second = await render(panel());
    expect(result()).toHaveTextContent(t('healthRecords.loading'));
    expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(1);
    lane.queryWorkoutPeriodHeartRate.mockImplementationOnce(async request => ({
      ...resultFor(request),
      mean: 121,
    }));
    await act(() => lane.transition('active'));
    await waitFor(() => expect(result()).toHaveTextContent('121 BPM'));
    expect(lane.queryWorkoutPeriodHeartRate).toHaveBeenCalledTimes(2);
    expect(lane.requestReadAuthorizations).not.toHaveBeenCalled();
    await second.unmount();
  } finally {
    lane.close();
  }
});
