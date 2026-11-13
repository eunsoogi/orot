import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Appointment, AppointmentRepository } from '@orot/storage';
import type { RecordingSourceRecord } from '../recording/recordingTypes';
import { AppState } from 'react-native';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../storage/localDataClearEvents';
import {
  appointmentDisplayUntil,
  selectNextAppointment,
} from './nextAppointment';

export type LibraryLoadState = 'loading' | 'ready' | 'failed';

/** Loads only persisted local summaries used by the Overview and Records roots. */
export function useAppOverviewData(
  loadAppointments: () => Promise<AppointmentRepository>,
  loadRecordings: () => Promise<readonly RecordingSourceRecord[]>,
  overviewActive = true,
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
  const previousOverviewActive = useRef(overviewActive);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    // Refresh at the nearest end boundary and on foreground; retained Overview scenes must not freeze their clock.
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
    const invalidateRecordings = () => {
      // The event does not name the source. Drop the snapshot until storage confirms surviving rows.
      setRecordings([]);
      refreshRecordings();
    };
    const unsubscribeDeletion = subscribeLocalSourceDeletion(
      invalidateRecordings,
      'local',
    );
    const unsubscribeClear = subscribeLocalDataClear(() => {
      setAppointments([]);
      refreshAppointments();
      invalidateRecordings();
    });
    return () => {
      activeRef.current = false;
      appointmentRequest.current += 1;
      recordingRequest.current += 1;
      unsubscribeClear();
      unsubscribeDeletion();
    };
  }, [refreshAppointments, refreshRecordings]);

  useEffect(() => {
    // Root-tab scenes can remain mounted. A return to Overview must include recordings or visits saved elsewhere.
    if (overviewActive && !previousOverviewActive.current) {
      refreshAppointments().catch(() => undefined);
      refreshRecordings().catch(() => undefined);
    }
    previousOverviewActive.current = overviewActive;
    const subscription = AppState.addEventListener('change', state => {
      if (overviewActive && state === 'active') {
        refreshAppointments().catch(() => undefined);
        refreshRecordings().catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, [overviewActive, refreshAppointments, refreshRecordings]);

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
