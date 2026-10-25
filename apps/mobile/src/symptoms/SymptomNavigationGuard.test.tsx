import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { NavigationLeaveStateRegistrationProvider } from '../navigation/useNavigationLeaveStateRegistration';
import type { NavigationLeaveStateRegistration } from '../navigation/useNavigationLeaveStateRegistration';
import SymptomsScreen from './SymptomsScreen';

jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default);

test('registers unsaved drafts, changes their revision, and blocks navigation during save', async () => {
  let source: Parameters<NavigationLeaveStateRegistration>[0] | undefined;
  const registerLeaveState: NavigationLeaveStateRegistration = value => {
    source = value;
    return () => { source = undefined; };
  };
  let finish: (() => void) | undefined;
  const saving = new Promise<void>(resolve => { finish = resolve; });
  await render(
    <NavigationLeaveStateRegistrationProvider registerLeaveState={registerLeaveState}>
      <SymptomsScreen entries={[]} onBack={jest.fn()} onRetry={jest.fn()}
        onFilterChange={jest.fn()} onCreate={() => saving}
        onUpdate={jest.fn()} onResolve={jest.fn()} />
    </NavigationLeaveStateRegistrationProvider>,
  );
  expect(source?.readState()).toMatchObject({ canLeave: true, hasUnsavedChanges: false });
  await fireEvent.press(screen.getByTestId('symptom-add'));
  expect(source?.readState().hasUnsavedChanges).toBe(true);
  expect(screen.getByTestId('symptom-filter-active')).toBeDisabled();
  const previousRevision = source?.readState().inputRevision;
  await fireEvent.changeText(screen.getByTestId('symptom-description'), 'Synthetic tingling');
  expect(source?.readState().inputRevision).toBeGreaterThan(previousRevision!);
  await fireEvent.changeText(screen.getByTestId('symptom-onset-date'), '2026-04-20');
  await fireEvent.changeText(screen.getByTestId('symptom-onset-time'), '08:30');
  await fireEvent.press(screen.getByTestId('symptom-status-active'));
  await fireEvent.press(screen.getByTestId('symptom-save'));
  expect(source?.readState()).toMatchObject({ canLeave: false, hasOngoingOperation: true });
  await act(async () => { finish?.(); await saving; });
  expect(source?.readState()).toMatchObject({ canLeave: true, hasUnsavedChanges: false });
});
