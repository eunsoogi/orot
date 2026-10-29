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
  homeActive = true,
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
  const appointmentRequest = useRef(0);
  const recordingRequest = useRef(0);
  const previousHomeActive = useRef(homeActive);
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
    const request = ++appointmentRequest.current;
    if (activeRef.current) setAppointmentState('loading');
    try {
      const repository = await loadAppointments();
      if (!activeRef.current || request !== appointmentRequest.current) return;
      const next = await repository.list();
      if (!activeRef.current || request !== appointmentRequest.current) return;
      setAppointmentRepository(repository);
      setAppointments(next);
      // Select the new snapshot against its receipt time, including visits that have already ended.
      setNow(Date.now());
      setAppointmentState('ready');
    } catch {
      if (activeRef.current && request === appointmentRequest.current)
        setAppointmentState('failed');
    }
  }, [loadAppointments]);
  const refreshRecordings = useCallback(async () => {
    const request = ++recordingRequest.current;
    if (activeRef.current) setRecordingState('loading');
    try {
      const next = await loadRecordings();
      if (!activeRef.current || request !== recordingRequest.current) return;
      setRecordings(next);
      setRecordingState('ready');
    } catch {
      if (activeRef.current && request === recordingRequest.current)
        setRecordingState('failed');
    }
  }, [loadRecordings]);

  useEffect(() => {
    activeRef.current = true;
    refreshAppointments().catch(() => undefined);
    refreshRecordings().catch(() => undefined);
    return () => {
      activeRef.current = false;
      appointmentRequest.current += 1;
      recordingRequest.current += 1;
    };
  }, [refreshAppointments, refreshRecordings]);

  useEffect(() => {
    // Root-tab scenes can remain mounted. A return to Home must include recordings or visits saved elsewhere.
    if (homeActive && !previousHomeActive.current) {
      refreshAppointments().catch(() => undefined);
      refreshRecordings().catch(() => undefined);
    }
    previousHomeActive.current = homeActive;
    const subscription = AppState.addEventListener('change', state => {
      if (homeActive && state === 'active') {
        refreshAppointments().catch(() => undefined);
        refreshRecordings().catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, [homeActive, refreshAppointments, refreshRecordings]);

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
