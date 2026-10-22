import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Appointment, AppointmentRepository } from '@orot/storage';
import type { RecordingSourceRecord } from '../recording/recordingTypes';
import { AppState } from 'react-native';
import {
  appointmentDisplayUntil,
  selectNextAppointment,
} from './nextAppointment';

export type LibraryLoadState = 'loading' | 'ready' | 'failed';

/** Loads only persisted local summaries used by the Home and Records roots. */
export function useAppHomeData(
  loadAppointments: () => Promise<AppointmentRepository>,
  loadRecordings: () => Promise<readonly RecordingSourceRecord[]>,
) {
  const [appointmentRepository, setAppointmentRepository] =
    useState<AppointmentRepository | null>(null);
  const [appointments, setAppointments] = useState<readonly Appointment[]>([]);
  const [appointmentState, setAppointmentState] =
    useState<LibraryLoadState>('loading');
  const [recordings, setRecordings] = useState<
    readonly RecordingSourceRecord[]
  >([]);
  const [recordingState, setRecordingState] =
    useState<LibraryLoadState>('loading');
  const activeRef = useRef(false);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    // Refresh at the nearest end boundary and on foreground; retained Home scenes must not freeze their clock.
    // An intervening data refresh must not restart a delay measured from an older minute tick.
    const schedulingTime = Date.now();
    const nextBoundary = Math.min(
      ...appointments
        .map(appointmentDisplayUntil)
        .filter(time => time > schedulingTime),
    );
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(1, Math.min(60_000, nextBoundary - schedulingTime)),
    );
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') setNow(Date.now());
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [appointments, now]);

  const refreshAppointments = useCallback(async () => {
    if (activeRef.current) setAppointmentState('loading');
    try {
      const repository = await loadAppointments();
      if (!activeRef.current) return;
      const next = await repository.list();
      if (!activeRef.current) return;
      setAppointmentRepository(repository);
      setAppointments(next);
      // Select the new snapshot against its receipt time, including visits that have already ended.
      setNow(Date.now());
      setAppointmentState('ready');
    } catch {
      if (activeRef.current) setAppointmentState('failed');
    }
  }, [loadAppointments]);
  const refreshRecordings = useCallback(async () => {
    if (activeRef.current) setRecordingState('loading');
    try {
      const next = await loadRecordings();
      if (!activeRef.current) return;
      setRecordings(next);
      setRecordingState('ready');
    } catch {
      if (activeRef.current) setRecordingState('failed');
    }
  }, [loadRecordings]);

  useEffect(() => {
    activeRef.current = true;
    refreshAppointments().catch(() => undefined);
    refreshRecordings().catch(() => undefined);
    return () => {
      activeRef.current = false;
    };
  }, [refreshAppointments, refreshRecordings]);

  const nextAppointment = useMemo(
    () => selectNextAppointment(appointments, now),
    [appointments, now],
  );

  return {
    appointmentRepository,
    appointmentState,
    nextAppointment,
    recordings,
    recordingState,
    refreshAppointments,
    refreshRecordings,
  };
}
