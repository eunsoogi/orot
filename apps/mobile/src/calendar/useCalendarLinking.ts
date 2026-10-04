import { AppState } from 'react-native';
import { useCallback, useEffect, useState } from 'react';
import type { Appointment, AppointmentRepository } from '@orot/storage';
import { t } from '../i18n';
import { calendarSnapshotsEqual } from './calendarSnapshot';
import type { CalendarAccessState, CalendarBridge, CalendarEvent } from './types';

type PendingCalendarChange =
  | { kind: 'changed'; event: CalendarEvent }
  | { kind: 'missing' };

function nextLinkedAppointment(appointments: Appointment[]): Appointment | null {
  const now = Date.now();
  return (
    appointments
      .filter(
        appointment =>
          (appointment.status === 'scheduled' || appointment.status === 'rescheduled') &&
          appointment.calendarEventIdentifier !== undefined &&
          appointment.calendarEventSnapshot !== undefined &&
          new Date(appointment.effectiveAt).getTime() > now,
      )
      .sort((left, right) => left.effectiveAt.localeCompare(right.effectiveAt))[0] ?? null
  );
}

function calendarEventMatchesAppointment(
  event: CalendarEvent,
  appointment: Appointment,
): boolean {
  return (
    event.calendarEventIdentifier === appointment.calendarEventIdentifier &&
    event.effectiveAt === appointment.effectiveAt &&
    event.endsAt === appointment.endsAt &&
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
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [pendingChange, setPendingChange] =
    useState<PendingCalendarChange | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const linkedAppointment = nextLinkedAppointment(appointments);

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
      if (!appointment.calendarEventIdentifier || !appointment.calendarEventSnapshot) return;
      try {
        const result = await bridge.findEvent(
          appointment.calendarEventIdentifier,
          appointment.calendarEventSnapshot.occurrenceDate,
        );
        setAccess(result.access);
        if (result.access !== 'fullAccess') {
          setPendingChange(null);
          return;
        }
        if (!result.event) {
          setPendingChange({ kind: 'missing' });
        } else if (!calendarEventMatchesAppointment(result.event, appointment)) {
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
        await repository.reconfirmCalendarEvent(linkedAppointment.id, selectedEvent);
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
      if (pendingChange?.kind === 'changed') setSelectedEvent(pendingChange.event);
    },
  };
}
