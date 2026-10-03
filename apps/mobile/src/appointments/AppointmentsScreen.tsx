import { useCallback, useEffect, useState } from 'react';
import { Button, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Appointment, AppointmentRepository } from '@orot/storage';
import {
  toAppointmentTimestamp,
  toAppointmentTimestampForEdit,
  toLocalAppointmentDateTime,
} from './dateTime';

interface AppointmentsScreenProps {
  repository: AppointmentRepository;
  onBack: () => void;
}

export default function AppointmentsScreen({ repository, onBack }: AppointmentsScreenProps) {
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

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setAppointments(await repository.list());
    } catch {
      setError('Appointments could not be loaded. Try again.');
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
  }

  async function saveAppointment() {
    const effectiveAt = editing
      ? toAppointmentTimestampForEdit(editing.effectiveAt, date, time)
      : toAppointmentTimestamp(date, time);
    if (!clinicLabel.trim()) {
      setError('Enter a clinic or specialty.');
      return;
    }
    if (!effectiveAt) {
      setError('Enter a valid local date and time.');
      return;
    }

    setSaving(true);
    setError('');
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
      setFormOpen(false);
      setNotice(editing ? 'Appointment updated.' : 'Appointment saved.');
      setEditing(null);
    } catch {
      setError('Appointment could not be saved. Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function cancelAppointment(appointment: Appointment) {
    setError('');
    try {
      await repository.cancel(appointment.id);
      await reload();
      setNotice('Appointment cancelled.');
    } catch {
      setError('Appointment could not be cancelled. Try again.');
    }
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      testID="appointments-scroll"
    >
      <View style={styles.topBar}>
        <Text accessibilityRole="header" style={styles.title} testID="appointments-title">
          Appointments
        </Text>
        <Button onPress={onBack} testID="appointments-back" title="Back" />
      </View>
      <Text style={styles.message}>Keep your visit details on this device.</Text>
      {notice ? <Text accessibilityLiveRegion="polite">{notice}</Text> : null}
      {error ? <Text accessibilityRole="alert" testID="appointment-error">{error}</Text> : null}

      {loading ? (
        <Text testID="appointments-loading">Loading appointments…</Text>
      ) : error && appointments.length === 0 ? (
        <Button onPress={reload} testID="appointments-retry" title="Try again" />
      ) : (
        <>
          {appointments.length === 0 ? (
            <Text testID="appointments-empty">No appointments yet.</Text>
          ) : (
            appointments.map(appointment => {
              const localTime = toLocalAppointmentDateTime(appointment.effectiveAt);
              const canEdit = appointment.status === 'scheduled' || appointment.status === 'rescheduled';
              return (
                <View key={appointment.id} style={styles.card} testID={`appointment-${appointment.id}`}>
                  <Text style={styles.clinic} testID={`appointment-clinic-${appointment.id}`}>
                    {appointment.clinicLabel ?? appointment.reason ?? 'Appointment'}
                  </Text>
                  <Text testID={`appointment-time-${appointment.id}`}>
                    {localTime.date} at {localTime.time} (local time)
                  </Text>
                  {appointment.note ? <Text>{appointment.note}</Text> : null}
                  <Text testID={`appointment-status-${appointment.id}`}>
                    {appointment.status.charAt(0).toUpperCase() + appointment.status.slice(1)}
                  </Text>
                  {canEdit ? (
                    <View style={styles.actions}>
                      <Button
                        onPress={() => startEditing(appointment)}
                        testID={`appointment-edit-${appointment.id}`}
                        title="Edit"
                      />
                      <Button
                        onPress={() => cancelAppointment(appointment)}
                        testID={`appointment-cancel-${appointment.id}`}
                        title="Cancel appointment"
                      />
                    </View>
                  ) : null}
                </View>
              );
            })
          )}
        </>
      )}

      {!formOpen ? (
        <Button onPress={startNewAppointment} testID="appointment-add" title="Add appointment" />
      ) : (
        <View style={styles.form}>
          <Text accessibilityRole="header" style={styles.formTitle}>
            {editing ? 'Edit appointment' : 'New appointment'}
          </Text>
          <TextInput
            accessibilityLabel="Clinic or specialty"
            onChangeText={setClinicLabel}
            placeholder="Clinic or specialty"
            style={styles.input}
            testID="appointment-clinic-input"
            value={clinicLabel}
          />
          <TextInput
            accessibilityLabel="Appointment date"
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
            style={styles.input}
            testID="appointment-date-input"
            value={date}
          />
          <TextInput
            accessibilityLabel="Appointment time"
            onChangeText={setTime}
            placeholder="HH:MM"
            style={styles.input}
            testID="appointment-time-input"
            value={time}
          />
          <Text style={styles.hint}>Date and time use your device’s local time zone.</Text>
          <TextInput
            accessibilityLabel="Optional appointment note"
            onChangeText={setNote}
            placeholder="Optional note"
            style={[styles.input, styles.note]}
            testID="appointment-note-input"
            value={note}
          />
          <Button
            disabled={saving}
            onPress={saveAppointment}
            testID="appointment-save"
            title={saving ? 'Saving…' : 'Save appointment'}
          />
          <Button
            disabled={saving}
            onPress={() => setFormOpen(false)}
            testID="appointment-form-cancel"
            title="Close"
          />
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12, padding: 20, backgroundColor: '#f7f8fa', minHeight: '100%' },
  topBar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  title: { color: '#17212b', fontSize: 24, fontWeight: '700' },
  message: { color: '#45515f', fontSize: 15 },
  card: { backgroundColor: 'white', borderRadius: 10, gap: 8, padding: 14 },
  clinic: { color: '#17212b', fontSize: 18, fontWeight: '600' },
  actions: { flexDirection: 'row', justifyContent: 'flex-start', gap: 16 },
  form: { backgroundColor: 'white', borderRadius: 10, gap: 10, padding: 14 },
  formTitle: { color: '#17212b', fontSize: 18, fontWeight: '600' },
  input: { borderColor: '#a8b3bf', borderRadius: 8, borderWidth: 1, padding: 10 },
  note: { minHeight: 48 },
  hint: { color: '#45515f', fontSize: 13 },
});
