import { act, fireEvent, render } from '@testing-library/react-native';
import type { CalendarEvent } from '../../../calendar/types';
import { EventKitImportSection } from '../EventKitImportSection';
import { createTestServices } from '../testSupport';
import type { UnifiedEventKitProgress, UnifiedImportRun } from '../types';

function progressFor(event: CalendarEvent): UnifiedEventKitProgress {
  return {
    status: 'complete',
    access: 'fullAccess',
    candidates: [event],
    appointmentConfirmed: false,
  };
}

// Hold the save until the current error UI is observed.
test('the current confirmation failure remains visible', async () => {
  const { calendarEvent } = createTestServices();
  let rejectConfirmation!: (reason?: unknown) => void;
  const confirmation = new Promise<void>((_resolve, reject) => {
    rejectConfirmation = reject;
  });
  const run = {
    confirmCalendarEvent: jest.fn(() => confirmation),
  } as unknown as UnifiedImportRun;
  const view = await render(
    <EventKitImportSection
      disabled={false}
      onToggle={jest.fn()}
      progress={progressFor(calendarEvent)}
      run={run}
      selected
    />,
  );

  await fireEvent.press(view.getByTestId('unified-import-eventkit-select-0'));
  await fireEvent.press(view.getByTestId('unified-import-eventkit-confirm'));
  await act(async () => {
    rejectConfirmation(new Error('current confirmation failed'));
    await confirmation.catch(() => undefined);
    await Promise.resolve();
  });

  expect(
    await view.findByTestId('unified-import-eventkit-save-error'),
  ).toBeTruthy();
}, 15000);
