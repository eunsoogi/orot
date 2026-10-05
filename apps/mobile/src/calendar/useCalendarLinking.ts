import { AppState } from 'react-native';
import { useCallback, useEffect, useState } from 'react';
import type { Appointment, AppointmentRepository } from '@orot/storage';
import { t } from '../i18n';
import { calendarSnapshotsEqual } from './calendarSnapshot';
import type {
  CalendarAccessState,
  CalendarBridge,
  CalendarEvent,
} from './types';

type PendingCalendarChange =
  { kind: 'changed'; event: CalendarEvent } | { kind: 'missing' };

function appointmentStartTime(appointment: Appointment): number {
  const snapshot = appointment.calendarEventSnapshot;
  const match =
    snapshot?.timeZoneIdentifier === null &&
    typeof snapshot.floatingStartAt === 'string'
      ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/.exec(
          snapshot.floatingStartAt,
        )
      : null;
  if (match) {
    const [, year, month, day, hour, minute, second, millisecond] = match;
    const localDate = new Date(0);
    localDate.setFullYear(Number(year), Number(month) - 1, Number(day));
    localDate.setHours(
      Number(hour),
      Number(minute),
      Number(second),
      Number(millisecond),
    );
    if (
      localDate.getFullYear() === Number(year) &&
      localDate.getMonth() === Number(month) - 1 &&
      localDate.getDate() === Number(day) &&
      localDate.getHours() === Number(hour) &&
      localDate.getMinutes() === Number(minute) &&
      localDate.getSeconds() === Number(second)
    ) {
      return localDate.getTime();
    }
  }
  return new Date(appointment.effectiveAt).getTime();
}

function selectLinkedAppointment(
  appointments: Appointment[],
): Appointment | null {
  const linked = appointments.filter(
    appointment =>
      (appointment.status === 'scheduled' ||
        appointment.status === 'rescheduled') &&
      appointment.calendarEventIdentifier !== undefined &&
      appointment.calendarEventSnapshot !== undefined,
  );
  const now = Date.now();
  linked.sort((left, right) => {
    const leftStart = appointmentStartTime(left);
    const rightStart = appointmentStartTime(right);
    const leftUpcoming = leftStart > now;
    const rightUpcoming = rightStart > now;
    if (leftUpcoming !== rightUpcoming) return leftUpcoming ? -1 : 1;
    return leftUpcoming ? leftStart - rightStart : rightStart - leftStart;
  });
  return linked[0] ?? null;
}

function calendarEventMatchesAppointment(
  event: CalendarEvent,
  appointment: Appointment,
): boolean {
  const eventSnapshot = event.calendarEventSnapshot;
  const appointmentSnapshot = appointment.calendarEventSnapshot;
  const hasFloatingCivilTimes =
    eventSnapshot.timeZoneIdentifier === null &&
    appointmentSnapshot?.timeZoneIdentifier === null &&
    typeof eventSnapshot.floatingStartAt === 'string' &&
    typeof eventSnapshot.floatingEndAt === 'string' &&
    eventSnapshot.floatingStartAt === appointmentSnapshot.floatingStartAt &&
    eventSnapshot.floatingEndAt === appointmentSnapshot.floatingEndAt;
  return (
    event.calendarEventIdentifier === appointment.calendarEventIdentifier &&
    (hasFloatingCivilTimes ||
      (event.effectiveAt === appointment.effectiveAt &&
        event.endsAt === appointment.endsAt)) &&
    event.calendarEventSnapshot !== undefined &&
    appointment.calendarEventSnapshot !== undefined &&
    calendarSnapshotsEqual(
      event.calendarEventSnapshot,
      appointment.calendarEventSnapshot,
    )
  );
}

export function useCalendarLinking(
  repository: AppointmentRepository,
  bridge: CalendarBridge,
) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loadingAppointments, setLoadingAppointments] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [saving, setSaving] = useState(false);
  const [access, setAccess] = useState<CalendarAccessState | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(
    null,
  );
  const [pendingChange, setPendingChange] =
    useState<PendingCalendarChange | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const linkedAppointment = selectLinkedAppointment(appointments);
  const nextVisitAppointment =
    linkedAppointment && appointmentStartTime(linkedAppointment) > Date.now()
      ? linkedAppointment
      : null;

  const reloadAppointments = useCallback(async () => {
    setLoadingAppointments(true);
    setError('');
    try {
      setAppointments(await repository.list());
    } catch {
      setError(t('appointments.loadError'));
    } finally {
      setLoadingAppointments(false);
    }
  }, [repository]);

  const verifyLinkedEvent = useCallback(
    async (appointment: Appointment) => {
      if (
        !appointment.calendarEventIdentifier ||
        !appointment.calendarEventSnapshot
      )
        return;
      try {
        const result = await bridge.findEvent(
          appointment.calendarEventIdentifier,
          appointment.calendarEventSnapshot.occurrenceDate,
          appointment.calendarEventSnapshot.floatingOccurrenceAt ?? null,
        );
        setAccess(result.access);
        if (result.access !== 'fullAccess') {
          setPendingChange(null);
          return;
        }
        if (!result.event) {
          setPendingChange({ kind: 'missing' });
        } else if (
          !calendarEventMatchesAppointment(result.event, appointment)
        ) {
          setPendingChange({ kind: 'changed', event: result.event });
        } else {
          setPendingChange(null);
        }
      } catch {
        setError(t('calendar.verifyError'));
      }
    },
    [bridge],
  );

  useEffect(() => {
    reloadAppointments().catch(() => undefined);
  }, [reloadAppointments]);

  useEffect(() => {
    if (!linkedAppointment) return undefined;
    const eventSubscription = bridge.addEventStoreListener(() => {
      verifyLinkedEvent(linkedAppointment).catch(() => undefined);
    });
    const appStateSubscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        verifyLinkedEvent(linkedAppointment).catch(() => undefined);
      }
    });
    verifyLinkedEvent(linkedAppointment).catch(() => undefined);
    return () => {
      eventSubscription.remove();
      appStateSubscription.remove();
    };
  }, [bridge, linkedAppointment, verifyLinkedEvent]);

  async function loadUpcomingEvents() {
    setLoadingEvents(true);
    setError('');
    setNotice('');
    setSelectedEvent(null);
    try {
      const result = await bridge.requestAccessAndListUpcomingEvents();
      setAccess(result.access);
      setEvents(result.access === 'fullAccess' ? result.events : []);
    } catch {
      setError(t('calendar.loadError'));
    } finally {
      setLoadingEvents(false);
    }
  }

  async function confirmSelectedEvent() {
    if (!selectedEvent) return;
    setSaving(true);
    setError('');
    try {
      if (linkedAppointment) {
        await repository.reconfirmCalendarEvent(
          linkedAppointment.id,
          selectedEvent,
        );
      } else {
        await repository.confirmCalendarEvent(selectedEvent);
      }
      await reloadAppointments();
      setSelectedEvent(null);
      setEvents([]);
      setPendingChange(null);
      setNotice(t('calendar.confirmed'));
    } catch {
      setError(t('calendar.confirmError'));
    } finally {
      setSaving(false);
    }
  }

  return {
    access,
    confirmSelectedEvent,
    error,
    events,
    linkedAppointment,
    nextVisitAppointment,
    loadUpcomingEvents,
    loadingAppointments,
    loadingEvents,
    notice,
    pendingChange,
    reloadAppointments,
    saving,
    selectEvent: setSelectedEvent,
    selectedEvent,
    clearSelection: () => setSelectedEvent(null),
    reviewChangedEvent: () => {
      if (pendingChange?.kind === 'changed')
        setSelectedEvent(pendingChange.event);
    },
  };
}
