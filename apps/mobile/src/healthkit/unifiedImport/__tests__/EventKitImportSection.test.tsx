import { act, fireEvent, render } from '@testing-library/react-native';
import type { CalendarEvent } from '../../../calendar/types';
import { EventKitImportSection } from '../EventKitImportSection';
import { createTestServices } from '../testSupport';
import type { UnifiedEventKitProgress, UnifiedImportRun } from '../types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function progressFor(event: CalendarEvent): UnifiedEventKitProgress {
  return {
    status: 'complete',
    access: 'fullAccess',
    candidates: [event],
    appointmentConfirmed: false,
  };
}

// A gated save and re-entry take longer than Jest's default on this host.
test('a late confirmation failure is hidden after a new run takes ownership', async () => {
  const { calendarEvent } = createTestServices();
  const oldConfirmation = deferred<void>();
  const oldRun = {
    confirmCalendarEvent: jest.fn(() => oldConfirmation.promise),
  } as unknown as UnifiedImportRun;
  const currentRun = {
    confirmCalendarEvent: jest.fn(),
  } as unknown as UnifiedImportRun;
  const view = await render(
    <EventKitImportSection
      disabled={false}
      onToggle={jest.fn()}
      progress={progressFor(calendarEvent)}
      run={oldRun}
      selected
    />,
  );
  expect(
    view.getByTestId('unified-import-toggle-eventKit').props.accessibilityRole,
  ).toBe('checkbox');
  expect(view.getByTestId('unified-import-indicator-eventKit')).toBeTruthy();

  // Drive the component buttons so the test covers the UI's async state owner.
  await fireEvent.press(view.getByTestId('unified-import-eventkit-select-0'));
  await fireEvent.press(view.getByTestId('unified-import-eventkit-confirm'));
  expect(oldRun.confirmCalendarEvent).toHaveBeenCalledWith(calendarEvent);

  await view.rerender(
    <EventKitImportSection
      disabled={false}
      onToggle={jest.fn()}
      progress={progressFor(calendarEvent)}
      run={currentRun}
      selected
    />,
  );

  await act(async () => {
    oldConfirmation.reject(new Error('old confirmation failed'));
    await oldConfirmation.promise.catch(() => undefined);
    await Promise.resolve();
  });
  expect(view.queryByTestId('unified-import-eventkit-save-error')).toBeNull();
}, 20000);
