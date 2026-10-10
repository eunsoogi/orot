import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Appointment, AppointmentRepository } from '@orot/storage';
import type { RecordingSourceRecord } from '../recording/recordingTypes';

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

  const refreshAppointments = useCallback(async () => {
    if (activeRef.current) setAppointmentState('loading');
    try {
      const repository = await loadAppointments();
      if (!activeRef.current) return;
      setAppointmentRepository(repository);
      setAppointments(await repository.list());
      if (activeRef.current) setAppointmentState('ready');
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
    () =>
      appointments
        .filter(
          appointment =>
            (appointment.status === 'scheduled' ||
              appointment.status === 'rescheduled') &&
            Date.parse(appointment.effectiveAt) > Date.now(),
        )
        .sort(
          (left, right) =>
            Date.parse(left.effectiveAt) - Date.parse(right.effectiveAt),
        )[0] ?? null,
    [appointments],
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
