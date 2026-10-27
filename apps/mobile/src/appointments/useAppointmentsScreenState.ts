import { useCallback, useEffect, useState } from 'react';
import type { Appointment, AppointmentRepository } from '@orot/storage';
import { t } from '../i18n';
import { useNavigationLeaveStateRegistration } from '../navigation';
import type { NavigationLeaveState } from '../navigation';
import {
  toAppointmentTimestamp,
  toAppointmentTimestampForEdit,
  toLocalAppointmentDateTime,
} from './dateTime';

interface UseAppointmentsScreenStateOptions {
  repository: AppointmentRepository;
  onAppointmentsChanged?: () => void;
}

/** Owns appointment loading, selection, and form state while layout panels reflow. */
export function useAppointmentsScreenState({
  repository,
  onAppointmentsChanged,
}: UseAppointmentsScreenStateOptions) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<
    string | null
  >(null);
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
        // Keep the selected record if it remains; after removal choose a valid record or none.
        setSelectedAppointmentId(current => {
          const preferredId = preferredSelectionId ?? current;
          return preferredId &&
            nextAppointments.some(appointment => appointment.id === preferredId)
            ? preferredId
            : (nextAppointments[0]?.id ?? null);
        });
      } catch {
        setError(t('appointments.loadError'));
      } finally {
        setLoading(false);
      }
    },
    [repository],
  );

  useEffect(() => {
    reload().catch(() => undefined);
  }, [reload]);

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
    setSelectedAppointmentId(appointment.id);
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
      await reload(saved.id);
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
