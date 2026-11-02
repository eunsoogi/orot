import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Appointment, AppointmentRepository } from '@orot/storage';
import { t } from '../i18n';
import { useNavigationLeaveStateRegistration } from '../navigation';
import type { NavigationLeaveState } from '../navigation';
import { selectNextAppointment } from '../routes/nextAppointment';
import {
  toAppointmentTimestamp,
  toAppointmentTimestampForEdit,
  toLocalAppointmentDateTime,
} from './dateTime';

interface UseAppointmentsScreenStateOptions {
  active: boolean;
  now: number;
  repository: AppointmentRepository;
  onAppointmentsChanged?: () => void;
}

/** Keeps explicit detail selection local and reloads its snapshot when a retained route regains focus. */
export function useAppointmentsScreenState({
  active,
  now,
  repository,
  onAppointmentsChanged,
}: UseAppointmentsScreenStateOptions) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [manualSelectionId, setManualSelectionId] = useState<string | null>(
    null,
  );
  const setSelectedAppointmentId = useCallback((id: string) => {
    setManualSelectionId(id);
  }, []);
  const [clinicLabel, setClinicLabel] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [inputRevision, setInputRevision] = useState(0);

  useNavigationLeaveStateRegistration({
    canLeave: !saving,
    hasUnsavedChanges: formOpen,
    isRecording: false,
    hasOngoingOperation: saving,
    revision,
    inputRevision,
  } satisfies NavigationLeaveState);

  const reload = useCallback(
    async (preferredSelectionId?: string) => {
      setLoading(true);
      setError('');
      try {
        const nextAppointments = await repository.list();
        setAppointments(nextAppointments);
        // Keep an explicit choice while present; only an empty choice may adopt the newly saved row.
        setManualSelectionId(current => {
          if (
            current &&
            nextAppointments.some(appointment => appointment.id === current)
          ) {
            return current;
          }
          if (
            preferredSelectionId &&
            nextAppointments.some(
              appointment => appointment.id === preferredSelectionId,
            )
          ) {
            return preferredSelectionId;
          }
          return null;
        });
      } catch {
        setError(t('appointments.loadError'));
      } finally {
        setLoading(false);
      }
    },
    [repository],
  );

  const nextAppointment = useMemo(
    () => selectNextAppointment(appointments, now),
    [appointments, now],
  );
  // The default detail uses the same selector as the list's next-visit marker.
  const selectedAppointment = useMemo(
    () =>
      (manualSelectionId
        ? appointments.find(appointment => appointment.id === manualSelectionId)
        : null) ?? nextAppointment,
    [appointments, manualSelectionId, nextAppointment],
  );
  const selectedAppointmentId = selectedAppointment?.id ?? null;

  useEffect(() => {
    if (active) reload().catch(() => undefined);
  }, [active, reload]);

  function startNewAppointment() {
    setEditing(null);
    setClinicLabel('');
    setDate('');
    setTime('');
    setNote('');
    setError('');
    setNotice('');
    setFormOpen(true);
    setRevision(current => current + 1);
    setInputRevision(current => current + 1);
  }

  function startEditing(appointment: Appointment) {
    const localTime = toLocalAppointmentDateTime(appointment.effectiveAt);
    // Editing an automatic choice must not pin it if the saved time changes the next visit.
    setEditing(appointment);
    setClinicLabel(appointment.clinicLabel ?? '');
    setDate(localTime.date);
    setTime(localTime.time);
    setNote(appointment.note ?? '');
    setError('');
    setFormOpen(true);
    setRevision(current => current + 1);
    setInputRevision(current => current + 1);
  }

  async function saveAppointment() {
    const effectiveAt = editing
      ? toAppointmentTimestampForEdit(editing.effectiveAt, date, time)
      : toAppointmentTimestamp(date, time);
    if (!clinicLabel.trim()) {
      setError(t('appointments.validation.clinicRequired'));
      return;
    }
    if (!effectiveAt) {
      setError(t('appointments.validation.dateTimeInvalid'));
      return;
    }

    const wasEditing = editing !== null;
    setSaving(true);
    setError('');
    setRevision(current => current + 1);
    const trimmedNote = note.trim();
    try {
      const saved = editing
        ? await repository.update(editing.id, {
            effectiveAt,
            clinicLabel: clinicLabel.trim(),
            note: trimmedNote || null,
          })
        : await repository.create({
            effectiveAt,
            clinicLabel: clinicLabel.trim(),
            ...(trimmedNote ? { note: trimmedNote } : {}),
          });
      await reload(wasEditing ? undefined : saved.id);
      // Home reads the same repository and refreshes only after the save succeeds.
      onAppointmentsChanged?.();
      setFormOpen(false);
      setNotice(
        wasEditing ? t('appointments.updated') : t('appointments.saved'),
      );
      setEditing(null);
      setRevision(current => current + 1);
    } catch {
      setError(t('appointments.saveError'));
    } finally {
      setSaving(false);
      setRevision(current => current + 1);
    }
  }

  async function cancelAppointment(appointment: Appointment) {
    setError('');
    try {
      await repository.cancel(appointment.id);
      await reload();
      onAppointmentsChanged?.();
      setNotice(t('appointments.cancelled'));
    } catch {
      setError(t('appointments.cancelError'));
    }
  }

  return {
    appointments,
    cancelAppointment,
    clinicLabel,
    date,
    editing,
    error,
    formOpen,
    loading,
    note,
    notice,
    saving,
    saveAppointment,
    nextAppointment,
    selectedAppointment,
    selectedAppointmentId,
    setClinicLabel,
    setDate,
    setFormOpen,
    setInputRevision,
    setNote,
    setRevision,
    setSelectedAppointmentId,
    setTime,
    startEditing,
    startNewAppointment,
    time,
    reload,
  };
}
