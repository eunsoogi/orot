import { AppState } from 'react-native';
import { useCallback, useEffect, useState } from 'react';
import type { Appointment, AppointmentRepository } from '@orot/storage';
import { t } from '../i18n';
import {
  calendarEventMatchesAppointment,
  calendarEventsEqual,
} from './calendarSnapshot';
import { appointmentStartTime } from './appointmentTime';
import type {
  CalendarAccessState,
  CalendarBridge,
  CalendarEvent,
} from './types';
import { emptyCalendarAutoSyncState } from './calendarAutoSync';
import type { CalendarAutoSyncState } from './calendarAutoSync';

const MAX_TIME_REFRESH_DELAY_MS = 24 * 60 * 60 * 1000;

type PendingCalendarChange =
  { kind: 'changed'; event: CalendarEvent } | { kind: 'missing' };

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

export function useCalendarLinking(
  repository: AppointmentRepository,
  bridge: CalendarBridge,
  calendarSync: CalendarAutoSyncState = emptyCalendarAutoSyncState,
) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [loadingAppointments, setLoadingAppointments] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verifiedAccess, setVerifiedAccess] =
    useState<CalendarAccessState | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(
    null,
  );
  const [pendingChange, setPendingChange] =
    useState<PendingCalendarChange | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const linkedAppointment = selectLinkedAppointment(appointments);
  const access = calendarSync.access ?? verifiedAccess;
  const events = calendarSync.events;
  const hasLoadedCandidates =
    calendarSync.access === 'fullAccess' && calendarSync.updatedAt !== null;
  const nextVisitAppointment =
    linkedAppointment && appointmentStartTime(linkedAppointment) > now
      ? linkedAppointment
      : null;
  const linkedAppointmentStart = linkedAppointment
    ? appointmentStartTime(linkedAppointment)
    : null;

  const reloadAppointments = useCallback(async () => {
    setLoadingAppointments(true);
    setError('');
    try {
      const loadedAppointments = await repository.list();
      // Linking can take long enough for a saved visit to pass its start time.
      setNow(Date.now());
      setAppointments(loadedAppointments);
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
        setVerifiedAccess(result.access);
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
    if (linkedAppointmentStart === null || linkedAppointmentStart <= now) {
      return undefined;
    }
    // Recheck at the visit boundary; cap long waits so distant visits stay within timer limits.
    const timeout = setTimeout(
      () => setNow(Date.now()),
      Math.min(linkedAppointmentStart - now, MAX_TIME_REFRESH_DELAY_MS),
    );
    return () => clearTimeout(timeout);
  }, [linkedAppointmentStart, now]);

  useEffect(() => {
    if (!linkedAppointment) return undefined;
    const eventSubscription = bridge.addEventStoreListener(() => {
      verifyLinkedEvent(linkedAppointment).catch(() => undefined);
    });
    const appStateSubscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        // EventKit can be unchanged after time passes, so refresh the time-derived visit filter too.
        setNow(Date.now());
        verifyLinkedEvent(linkedAppointment).catch(() => undefined);
      }
    });
    verifyLinkedEvent(linkedAppointment).catch(() => undefined);
    return () => {
      eventSubscription.remove();
      appStateSubscription.remove();
    };
  }, [bridge, linkedAppointment, verifyLinkedEvent]);

  async function confirmSelectedEvent() {
    if (!selectedEvent) return;
    setSaving(true);
    setError('');
    try {
      // The user may leave a candidate selected while EventKit changes in the background.
      const latest = await bridge.findEvent(
        selectedEvent.calendarEventIdentifier,
        selectedEvent.calendarEventSnapshot.occurrenceDate,
        selectedEvent.calendarEventSnapshot.floatingOccurrenceAt ?? null,
      );
      setVerifiedAccess(latest.access);
      if (latest.access !== 'fullAccess') {
        setError(t('calendar.verifyError'));
        return;
      }
      if (!latest.event) {
        setPendingChange({ kind: 'missing' });
        setSelectedEvent(null);
        return;
      }
      if (!calendarEventsEqual(latest.event, selectedEvent)) {
        setPendingChange({ kind: 'changed', event: latest.event });
        setSelectedEvent(null);
        return;
      }
      if (linkedAppointment) {
        await repository.reconfirmCalendarEvent(
          linkedAppointment.id,
          latest.event,
        );
      } else {
        await repository.confirmCalendarEvent(latest.event);
      }
      await reloadAppointments();
      setSelectedEvent(null);
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
    hasLoadedCandidates,
    linkedAppointment,
    nextVisitAppointment,
    loadingAppointments,
    loadingEvents: calendarSync.loading,
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
