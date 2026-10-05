import { AppState, type AppStateStatus } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import type { Appointment } from '@orot/storage';
import CalendarLinkingScreen from '../CalendarLinkingScreen';
import type { CalendarEvent } from '../types';
import {
  appointmentFor,
  bridge,
  event,
  floatingDateTime,
  repository,
} from '../calendarTestUtils';

describe('Calendar linked event revalidation', () => {
  it('uses the current time when linked appointments finish loading', async () => {
    let currentTime = Date.now();
    const appointmentStart = currentTime + 60_000;
    const selected = event(
      'loaded-after-start',
      new Date(appointmentStart).toISOString(),
    );
    let resolveAppointments: ((items: Appointment[]) => void) | undefined;
    const appointments = repository(
      () =>
        new Promise(resolve => {
          resolveAppointments = resolve;
        }),
    );
    const findEvent = jest.fn(async () => ({
      access: 'fullAccess' as const,
      event: selected,
    }));
    const calendar = bridge({ findEvent });
    const appStateSpy = jest
      .spyOn(AppState, 'addEventListener')
      .mockReturnValue({ remove: jest.fn() } as never);
    const clockSpy = jest
      .spyOn(Date, 'now')
      .mockImplementation(() => currentTime);
    try {
      await render(
        <CalendarLinkingScreen repository={appointments} bridge={calendar} />,
      );
      currentTime = appointmentStart + 1;
      await act(async () => {
        resolveAppointments?.([appointmentFor(selected)]);
        await Promise.resolve();
      });

      expect(screen.queryByTestId('calendar-next-visit')).toBeNull();
      expect(findEvent).toHaveBeenCalledTimes(1);
    } finally {
      appStateSpy.mockRestore();
      clockSpy.mockRestore();
    }
  });

  it('hides an unchanged visit after it starts while the screen stays active', async () => {
    const initialTime = Date.now();
    jest.useFakeTimers({ now: initialTime });
    const appointmentStart = initialTime + 60_000;
    const selected = event(
      'starting-visit',
      new Date(appointmentStart).toISOString(),
    );
    const appointments = repository(async () => [appointmentFor(selected)]);
    const findEvent = jest.fn(async () => ({
      access: 'fullAccess' as const,
      event: selected,
    }));
    const calendar = bridge({ findEvent });
    const appStateSpy = jest
      .spyOn(AppState, 'addEventListener')
      .mockReturnValue({ remove: jest.fn() } as never);
    try {
      await render(
        <CalendarLinkingScreen repository={appointments} bridge={calendar} />,
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByTestId('calendar-next-visit')).toBeTruthy();
      await act(async () => {
        jest.advanceTimersByTime(60_000);
      });

      expect(screen.queryByTestId('calendar-next-visit')).toBeNull();
      expect(findEvent).toHaveBeenCalledTimes(1);
    } finally {
      appStateSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  it('hides an unchanged visit after it elapses while the app was backgrounded', async () => {
    let currentTime = Date.now();
    const appointmentStart = currentTime + 60_000;
    const selected = event(
      'elapsing-visit',
      new Date(appointmentStart).toISOString(),
    );
    const appointments = repository(async () => [appointmentFor(selected)]);
    const findEvent = jest.fn(async () => ({
      access: 'fullAccess' as const,
      event: selected,
    }));
    const calendar = bridge({ findEvent });
    let onAppStateChange: ((state: AppStateStatus) => void) | undefined;
    const appStateSpy = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event, listener) => {
        onAppStateChange = listener;
        return { remove: jest.fn() } as never;
      });
    const clockSpy = jest
      .spyOn(Date, 'now')
      .mockImplementation(() => currentTime);
    try {
      await render(
        <CalendarLinkingScreen repository={appointments} bridge={calendar} />,
      );

      expect(await screen.findByTestId('calendar-next-visit')).toBeTruthy();
      await act(async () => {
        await Promise.resolve();
      });
      expect(findEvent).toHaveBeenCalledTimes(1);

      onAppStateChange?.('background');
      currentTime = appointmentStart + 1;
      await act(async () => {
        onAppStateChange?.('active');
        await Promise.resolve();
      });

      expect(screen.queryByTestId('calendar-next-visit')).toBeNull();
      expect(findEvent).toHaveBeenCalledTimes(2);
    } finally {
      appStateSpy.mockRestore();
      clockSpy.mockRestore();
    }
  });

  it('rechecks a linked event whose saved time passed while the app was closed', async () => {
    const current = appointmentFor(
      event(
        'rescheduled-while-closed',
        new Date(Date.now() - 86_400_000).toISOString(),
      ),
    );
    const movedEvent = event(
      'rescheduled-while-closed',
      new Date(Date.now() + 86_400_000).toISOString(),
    );
    const appointments = repository(async () => [current]);
    const findEvent = jest.fn(async () => ({
      access: 'fullAccess' as const,
      event: movedEvent,
    }));
    const calendar = bridge({ findEvent });
    const appStateSpy = jest
      .spyOn(AppState, 'addEventListener')
      .mockReturnValue({ remove: jest.fn() } as never);
    try {
      await render(
        <CalendarLinkingScreen repository={appointments} bridge={calendar} />,
      );

      expect(await screen.findByTestId('calendar-change-warning')).toBeTruthy();
      expect(findEvent).toHaveBeenCalledWith(
        'rescheduled-while-closed',
        null,
        null,
      );
      expect(screen.queryByTestId('calendar-next-visit')).toBeNull();
      expect(appointments.reconfirmCalendarEvent).not.toHaveBeenCalled();
    } finally {
      appStateSpy.mockRestore();
    }
  });

  it('keeps a floating visit upcoming and unchanged when its absolute time changes with the device zone', async () => {
    const newLocalStart = new Date(Date.now() + 86_400_000);
    const newLocalEnd = new Date(newLocalStart.getTime() + 3_600_000);
    const priorAbsoluteStart = new Date(Date.now() - 86_400_000).toISOString();
    const priorEvent = event('floating-visit', priorAbsoluteStart);
    const stored = {
      ...priorEvent,
      calendarEventSnapshot: {
        ...priorEvent.calendarEventSnapshot,
        timeZoneIdentifier: null,
        floatingStartAt: floatingDateTime(newLocalStart),
        floatingEndAt: floatingDateTime(newLocalEnd),
        floatingOccurrenceAt: null,
      },
    } as CalendarEvent;
    const currentEvent = {
      ...stored,
      effectiveAt: newLocalStart.toISOString(),
      endsAt: newLocalEnd.toISOString(),
    };
    const appointments = repository(async () => [appointmentFor(stored)]);
    const findEvent = jest.fn(async () => ({
      access: 'fullAccess' as const,
      event: currentEvent,
    }));
    const calendar = bridge({ findEvent });
    const appStateSpy = jest
      .spyOn(AppState, 'addEventListener')
      .mockReturnValue({ remove: jest.fn() } as never);
    try {
      await render(
        <CalendarLinkingScreen repository={appointments} bridge={calendar} />,
      );

      expect(await screen.findByTestId('calendar-next-visit')).toBeTruthy();
      expect(screen.getByTestId('calendar-next-visit-time')).toHaveTextContent(
        /현지 시간/u,
      );
      expect(findEvent).toHaveBeenCalledWith('floating-visit', null, null);
      expect(screen.queryByTestId('calendar-change-warning')).toBeNull();
    } finally {
      appStateSpy.mockRestore();
    }
  });
});
