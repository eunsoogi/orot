import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { openLocalRecordQueryService } from '../src/agent/localRecordQuery';
import {
  getCipherVersion,
  openLocalStorage,
  verifyWrongKeyRejected,
} from '../src/storage/secureDatabase';
import {
  createLocalQueryProbeFixtures,
  localQueryWindow,
} from './localRecordQueryProbeFixtures';

async function runQueryProbe(): Promise<string> {
  const repository = await openLocalStorage();
  const fixture = createLocalQueryProbeFixtures();
  const types = [
    'blood_pressure',
    'sleep',
    'heart_rate',
    'steps',
    'body_mass',
  ] as const;
  let cleanup = false;

  try {
    await repository.sourceRecords.create(fixture.healthSource);
    await repository.sourceRecords.create(fixture.audioSource);
    for (const row of fixture.healthRows)
      await repository.put('health_observation', row);
    await repository.put('medication_definition', fixture.medication);
    await repository.put('dose_event', fixture.dose);
    await repository.put('appointment', fixture.appointment);
    await repository.transcripts.append([fixture.transcript]);

    const service = await openLocalRecordQueryService();
    const healthResults = await Promise.all(
      types.map(type =>
        service.queryHealthObservations({
          type,
          ...localQueryWindow,
          limit: 10,
        }),
      ),
    );
    const healthCount = healthResults.reduce(
      (sum, result) => sum + result.records.length,
      0,
    );
    const sleep = healthResults[1]?.records[0];
    const medication = await service.queryImportedMedicationDefinitions({
      ...localQueryWindow,
      limit: 10,
    });
    const dose = await service.queryImportedDoseEvents({
      ...localQueryWindow,
      limit: 10,
    });
    const appointment = await service.queryNextConfirmedCalendarAppointment(
      localQueryWindow.toExclusive,
    );
    const transcript = await service.queryTranscriptEvidence({
      recordingSourceId: fixture.audioSource.id,
      ...localQueryWindow,
      limit: 10,
    });

    if (
      healthCount !== 6 ||
      healthResults[0]?.records.length !== 2 ||
      sleep?.value.kind !== 'text' ||
      sleep.value.text !== 'asleepDeep' ||
      medication.records[0]?.effectiveAt !== undefined ||
      medication.timeBasis !== 'local_ingest' ||
      dose.records[0]?.observationStatus !== 'not_logged' ||
      appointment.appointment?.calendarEventIdentifier !==
        'synthetic-confirmed-event' ||
      transcript.records[0]?.provenance.sourceRecordIds[0] !==
        fixture.audioSource.id
    ) {
      throw new Error(
        'The bounded local query probe returned incomplete synthetic evidence.',
      );
    }
  } finally {
    // Transcript revisions and stale links are removed with their owning audio source.
    await repository.sourceRecords.delete(fixture.audioSource.id);
    for (const row of fixture.healthRows)
      await repository.delete('health_observation', row.id);
    await repository.delete('dose_event', fixture.dose.id);
    await repository.delete('medication_definition', fixture.medication.id);
    await repository.delete('appointment', fixture.appointment.id);
    await repository.sourceRecords.delete(fixture.healthSource.id);
    const cleanupService = await openLocalRecordQueryService();
    const remainingHealth = await Promise.all(
      types.map(type =>
        cleanupService.queryHealthObservations({ type, ...localQueryWindow }),
      ),
    );
    const [
      remainingMedication,
      remainingDose,
      remainingAppointment,
      remainingTranscript,
    ] = await Promise.all([
      cleanupService.queryImportedMedicationDefinitions(localQueryWindow),
      cleanupService.queryImportedDoseEvents(localQueryWindow),
      cleanupService.queryNextConfirmedCalendarAppointment(
        localQueryWindow.fromInclusive,
      ),
      cleanupService.queryTranscriptEvidence({
        recordingSourceId: fixture.audioSource.id,
        ...localQueryWindow,
      }),
    ]);
    cleanup =
      remainingHealth.every(result => result.records.length === 0) &&
      remainingMedication.records.length === 0 &&
      remainingDose.records.length === 0 &&
      remainingAppointment.appointment === null &&
      remainingTranscript.records.length === 0 &&
      remainingTranscript.staleArtifacts.length === 0 &&
      (await repository.sourceRecords.get(fixture.audioSource.id)) === null &&
      (await repository.sourceRecords.get(fixture.healthSource.id)) === null;
  }

  const cipherVersion = await getCipherVersion();
  const wrongKeyRejected = await verifyWrongKeyRejected();
  if (!cipherVersion || !wrongKeyRejected || !cleanup) {
    throw new Error('The SQLCipher or synthetic-fixture cleanup check failed.');
  }
  return 'healthQueries=5; healthRecords=6; bloodPressure=2; sleep=asleepDeep; dose=not_logged; medication=timeBasis:local_ingest; appointment=confirmed; transcript=source-linked; cipher=available; wrongKey=rejected; cleanup=true';
}

/** Exercises the production adapter without contacting HealthKit, Calendar, or a real account. */
export function LocalRecordQueryProbe() {
  const [summary, setSummary] = useState(
    'probe=ready; storage=encrypted-local',
  );
  useEffect(() => {
    runQueryProbe()
      .then(setSummary)
      .catch(error => {
        setSummary('probe=failed; storage=encrypted-local');
        const message = error instanceof Error ? error.message : String(error);
        console.error('LOCAL_QUERY_SIMULATOR_FAILURE ' + message);
      });
  }, []);

  return (
    <View style={styles.container}>
      <Text
        accessibilityLiveRegion="polite"
        style={styles.summary}
        testID="local-query-probe-summary"
      >
        {summary}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 20 },
  summary: { fontSize: 12 },
});
