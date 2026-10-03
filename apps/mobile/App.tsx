import { useState } from 'react';
import { Button, Text, View } from 'react-native';
import type { AppointmentRepository } from '@orot/storage';
import type { SymptomEntry, SymptomEntryFilter } from '@orot/storage';
import styles from './App.styles';
import type { SymptomJournalRepository } from './src/symptoms/localRepository';
import type {
  NewSymptomDraft,
  SymptomEdit,
  SymptomFilter,
} from './src/symptoms/types';
import AppointmentsScreen from './src/appointments/AppointmentsScreen';
import SymptomsScreen from './src/symptoms/SymptomsScreen';

declare const require: {
  (path: './src/appointments/localRepository'): {
    openLocalAppointmentRepository: () => Promise<AppointmentRepository>;
  };
  (path: './src/symptoms/localRepository'): {
    openLocalSymptomJournal: () => Promise<SymptomJournalRepository>;
  };
};

interface AppProps {
  loadAppointments?: () => Promise<AppointmentRepository>;
  loadSymptoms?: () => Promise<SymptomJournalRepository>;
}

function defaultAppointmentLoader(): Promise<AppointmentRepository> {
  return require('./src/appointments/localRepository').openLocalAppointmentRepository();
}

function defaultSymptomLoader(): Promise<SymptomJournalRepository> {
  return require('./src/symptoms/localRepository').openLocalSymptomJournal();
}

export default function App({
  loadAppointments = defaultAppointmentLoader,
  loadSymptoms = defaultSymptomLoader,
}: AppProps) {
  const [hasStarted, setHasStarted] = useState(false);
  const [showAppointments, setShowAppointments] = useState(false);
  const [appointmentRepository, setAppointmentRepository] =
    useState<AppointmentRepository | null>(null);
  const [loadingAppointments, setLoadingAppointments] = useState(false);
  const [appointmentError, setAppointmentError] = useState('');
  const [showSymptoms, setShowSymptoms] = useState(false);
  const [symptomRepository, setSymptomRepository] =
    useState<SymptomJournalRepository | null>(null);
  const [symptomEntries, setSymptomEntries] = useState<SymptomEntry[]>([]);
  const [symptomFilter, setSymptomFilter] = useState<SymptomEntryFilter>({});
  const [loadingSymptoms, setLoadingSymptoms] = useState(false);
  const [symptomError, setSymptomError] = useState('');

  async function openAppointments() {
    setShowAppointments(true);
    setAppointmentError('');
    if (appointmentRepository) return;
    setLoadingAppointments(true);
    try {
      setAppointmentRepository(await loadAppointments());
    } catch {
      setAppointmentError('Appointments could not be opened. Try again.');
    } finally {
      setLoadingAppointments(false);
    }
  }

  async function loadSymptomEntries(
    filter: SymptomEntryFilter = symptomFilter,
    repository: SymptomJournalRepository | null = symptomRepository,
  ) {
    if (!repository) return;
    setLoadingSymptoms(true);
    setSymptomError('');
    try {
      setSymptomEntries(await repository.list(filter));
    } catch {
      setSymptomEntries([]);
      setSymptomError('Symptoms could not be loaded. Try again.');
    } finally {
      setLoadingSymptoms(false);
    }
  }

  async function openSymptoms() {
    setShowSymptoms(true);
    setSymptomError('');
    if (symptomRepository) {
      await loadSymptomEntries(symptomFilter);
      return;
    }
    setLoadingSymptoms(true);
    let opened = false;
    try {
      const repository = await loadSymptoms();
      opened = true;
      setSymptomRepository(repository);
      setSymptomEntries(await repository.list({}));
      setSymptomFilter({});
    } catch {
      setSymptomEntries([]);
      setSymptomError(
        opened
          ? 'Symptoms could not be loaded. Try again.'
          : 'Symptoms could not be opened. Try again.',
      );
    } finally {
      setLoadingSymptoms(false);
    }
  }

  async function createSymptom(draft: NewSymptomDraft) {
    if (!symptomRepository) throw new Error('The symptom journal is not open.');
    await symptomRepository.create(draft);
    await loadSymptomEntries();
  }

  async function updateSymptom(id: string, changes: SymptomEdit) {
    if (!symptomRepository) throw new Error('The symptom journal is not open.');
    const updated = await symptomRepository.update(id, changes);
    if (!updated) throw new Error('The symptom entry no longer exists.');
    await loadSymptomEntries();
  }

  async function resolveSymptom(id: string) {
    if (!symptomRepository) throw new Error('The symptom journal is not open.');
    const resolved = await symptomRepository.resolve(id);
    if (!resolved) throw new Error('The symptom entry no longer exists.');
    await loadSymptomEntries();
  }

  async function changeSymptomFilter(filter: SymptomFilter) {
    setSymptomFilter(filter);
    await loadSymptomEntries(filter);
  }

  if (showAppointments) {
    if (appointmentRepository) {
      return (
        <AppointmentsScreen
          onBack={() => setShowAppointments(false)}
          repository={appointmentRepository}
        />
      );
    }
    return (
      <View style={styles.container}>
        <Text accessibilityRole="header" style={styles.title}>
          Appointments
        </Text>
        <Text testID="appointments-opening">
          {loadingAppointments
            ? 'Opening encrypted storage…'
            : appointmentError}
        </Text>
        {!loadingAppointments ? (
          <Button
            onPress={openAppointments}
            testID="appointments-retry-open"
            title="Try again"
          />
        ) : null}
        <Button
          onPress={() => setShowAppointments(false)}
          testID="appointments-back"
          title="Back"
        />
      </View>
    );
  }

  if (showSymptoms) {
    if (symptomRepository) {
      return (
        <SymptomsScreen
          entries={symptomEntries}
          loadError={symptomError}
          filter={symptomFilter}
          loading={loadingSymptoms}
          onBack={() => setShowSymptoms(false)}
          onCreate={createSymptom}
          onFilterChange={changeSymptomFilter}
          onRetry={() => loadSymptomEntries(symptomFilter)}
          onResolve={resolveSymptom}
          onUpdate={updateSymptom}
        />
      );
    }
    return (
      <View style={styles.container}>
        <Text accessibilityRole="header" style={styles.title}>
          Symptoms
        </Text>
        <Text testID="symptoms-opening">
          {loadingSymptoms ? 'Opening encrypted storage…' : symptomError}
        </Text>
        {!loadingSymptoms ? (
          <Button
            onPress={openSymptoms}
            testID="symptoms-retry-open"
            title="Try again"
          />
        ) : null}
        <Button
          onPress={() => setShowSymptoms(false)}
          testID="symptoms-open-back"
          title="Back"
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text
        accessibilityRole="header"
        style={styles.title}
        testID="welcome-title"
      >
        Orot workspace ready
      </Text>
      <Text style={styles.message}>
        {hasStarted
          ? 'You are ready to build.'
          : 'A simple foundation for Orot.'}
      </Text>
      <Button
        onPress={() => setHasStarted(true)}
        testID="get-started"
        title="Get started"
      />
      <Button
        onPress={openAppointments}
        testID="open-appointments"
        title="Appointments"
      />
      <Button onPress={openSymptoms} testID="symptoms-open" title="Symptoms" />
    </View>
  );
}
