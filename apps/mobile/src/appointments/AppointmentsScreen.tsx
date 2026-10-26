import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import type { Appointment, AppointmentRepository } from '@orot/storage';
import { AppButton as Button } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import AppointmentCard from './AppointmentCard';
import AppointmentForm from './AppointmentForm';
import styles from './appointmentsStyles';
import { useNavigationLeaveStateRegistration } from '../navigation';
import type { NavigationLeaveState } from '../navigation';
import {
  toAppointmentTimestamp,
  toAppointmentTimestampForEdit,
  toLocalAppointmentDateTime,
} from './dateTime';

interface AppointmentsScreenProps {
  repository: AppointmentRepository;
  onAppointmentsChanged?: () => void;
}

export default function AppointmentsScreen({
  repository,
  onAppointmentsChanged,
}: AppointmentsScreenProps) {
  const navigationInset = useNavigationContentInset();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
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

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setAppointments(await repository.list());
    } catch {
      setError(t('appointments.loadError'));
    } finally {
      setLoading(false);
    }
  }, [repository]);

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

    setSaving(true);
    setError('');
    setRevision(current => current + 1);
    const trimmedNote = note.trim();
    try {
      if (editing) {
        await repository.update(editing.id, {
          effectiveAt,
          clinicLabel: clinicLabel.trim(),
          note: trimmedNote || null,
        });
      } else {
        await repository.create({
          effectiveAt,
          clinicLabel: clinicLabel.trim(),
          ...(trimmedNote ? { note: trimmedNote } : {}),
        });
      }
      await reload();
      // Home reads the same repository and refreshes only after the save succeeds.
      onAppointmentsChanged?.();
      setFormOpen(false);
      setNotice(editing ? t('appointments.updated') : t('appointments.saved'));
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

  return (
    <ScrollView
      // Starting an edit replaces the list and resets its potentially distant scroll offset.
      key={formOpen ? 'editor' : 'list'}
      contentContainerStyle={[styles.container, navigationInset]}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      style={styles.scroll}
      testID="appointments-scroll"
    >
      {!formOpen ? (
        <Text
          accessibilityRole="header"
          style={styles.title}
          testID="appointments-title"
        >
          {t('appointments.title')}
        </Text>
      ) : null}
      {!formOpen ? (
        <Text style={styles.message}>{t('appointments.description')}</Text>
      ) : null}
      {notice ? <Text accessibilityLiveRegion="polite">{notice}</Text> : null}
      {error ? (
        <Text
          accessibilityRole="alert"
          style={styles.error}
          testID="appointment-error"
        >
          {error}
        </Text>
      ) : null}

      {formOpen ? null : loading ? (
        <Text testID="appointments-loading">{t('appointments.loading')}</Text>
      ) : error && appointments.length === 0 ? (
        <Button
          onPress={reload}
          testID="appointments-retry"
          title={t('appointments.retry')}
        />
      ) : (
        <>
          {appointments.length === 0 ? (
            <Text testID="appointments-empty">{t('appointments.empty')}</Text>
          ) : (
            appointments.map(appointment => (
              <AppointmentCard
                key={appointment.id}
                appointment={appointment}
                onEdit={() => startEditing(appointment)}
                onCancel={() => cancelAppointment(appointment)}
              />
            ))
          )}
        </>
      )}

      {!formOpen ? (
        <Button
          onPress={startNewAppointment}
          testID="appointment-add"
          title={t('appointments.actions.add')}
        />
      ) : (
        <AppointmentForm
          editing={Boolean(editing)}
          clinicLabel={clinicLabel}
          date={date}
          time={time}
          note={note}
          saving={saving}
          onClinicLabelChange={value => {
            setClinicLabel(value);
            setInputRevision(current => current + 1);
          }}
          onDateChange={value => {
            setDate(value);
            setInputRevision(current => current + 1);
          }}
          onTimeChange={value => {
            setTime(value);
            setInputRevision(current => current + 1);
          }}
          onNoteChange={value => {
            setNote(value);
            setInputRevision(current => current + 1);
          }}
          onSave={saveAppointment}
          onClose={() => {
            setFormOpen(false);
            setRevision(current => current + 1);
          }}
        />
      )}
    </ScrollView>
  );
}
