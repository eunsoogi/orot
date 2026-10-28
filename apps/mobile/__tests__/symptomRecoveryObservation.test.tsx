import { act, render } from '@testing-library/react-native';
import { NativeModules, Text } from 'react-native';
import { SymptomRecoveryObservation } from '../e2e/SymptomRecoveryObservation';
import { observeNavigationTest } from '../src/navigation/navigationTestObservation';

it('exposes the snapshot marker, requests native observations, and unregisters on unmount', async () => {
  const snapshot = {
    atMs: 123,
    lifecycle: [{ event: 'symptom-focus-diagnostic' }],
  };
  const recordObservation = jest.fn();
  const navigationSnapshot = jest.fn().mockResolvedValue(snapshot);
  const previous = NativeModules.OrotTestControl;
  NativeModules.OrotTestControl = { recordObservation, navigationSnapshot };
  try {
    const screen = await render(
      <SymptomRecoveryObservation>
        <Text>Fixture</Text>
      </SymptomRecoveryObservation>,
    );
    await act(async () =>
      observeNavigationTest('symptom-focus-diagnostic', {
        phase: 'scroll-requested',
      }),
    );
    expect(recordObservation).toHaveBeenCalledTimes(1);
    expect(navigationSnapshot).toHaveBeenCalledTimes(1);
    // Native setNativeProps label delivery is verified by the actual XCTest snapshot, not this renderer.
    expect(screen.getByTestId('navigation-test-observation')).toBeTruthy();
    await screen.unmount();
    observeNavigationTest('symptom-focus-diagnostic', {
      phase: 'after-unmount',
    });
    expect(recordObservation).toHaveBeenCalledTimes(1);
  } finally {
    NativeModules.OrotTestControl = previous;
  }
});
