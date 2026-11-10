import { useEffect, useState } from 'react';
import {
  NativeModules,
  Pressable,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import type { Appointment } from '@orot/domain';
import type { RecordRepository } from '@orot/storage';
import { clarificationQuestions } from '../src/agent/visitQuestions/clarificationQuestions';
import { localEvidenceFingerprint } from '../src/agent/visitQuestions/evidence';
import { saveReviewedVisitQuestions } from '../src/agent/visitQuestions/persistence';
import type { VisitQuestionEvidenceItem } from '../src/agent/visitQuestions/taskContract';
import { loadSavedVisitQuestionState } from '../src/aiFeatures/integration/savedVisitQuestions';
import { LocalEvidenceReferenceRegistry } from '../src/aiFeatures/integration/evidenceRegistry';
import { createLocalHealthEvidenceRepository } from '../src/healthEvidence/localEvidenceRepository';
import { createNextVisitQuestionsTheme } from '../src/aiFeatures/integration/nextVisitQuestionsRoutePresentation';
import {
  getCipherVersion,
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../src/storage/secureDatabase';
import { NextVisitQuestionsScreen } from '../src/nextVisitQuestions';
import type {
  NextVisitQuestionsScreenProps,
  SavedQuestionsState,
} from '../src/nextVisitQuestions/types';

const base = {
  effectiveAt: '2035-06-02T09:30:00.000Z',
  recordedAt: '2026-01-01T00:00:00.000Z',
  ingestedAt: '2026-01-01T00:00:00.000Z',
  provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' as const },
  status: 'scheduled' as const,
  calendarEventSnapshot: {
    title: 'Synthetic visit',
    timeZoneIdentifier: 'UTC',
    isAllDay: false,
    occurrenceDate: '2035-06-02T09:30:00.000Z',
    isDetached: false,
    recurrenceRules: [],
  },
};
const visits: readonly Appointment[] = [
  {
    ...base,
    id: 'synthetic-visit-a',
    calendarEventIdentifier: 'synthetic-calendar-a',
  },
  {
    ...base,
    id: 'synthetic-visit-b',
    calendarEventIdentifier: 'synthetic-calendar-b',
  },
];
const candidates = clarificationQuestions.slice(0, 3).map(item => ({
  ...item,
  kind: 'clarification' as const,
  priority: 'routine' as const,
  citations: [],
}));
type Props = NextVisitQuestionsScreenProps<VisitQuestionEvidenceItem>;

/** The model output is synthetic; persistence and restoration use the app's SQLCipher and Keychain adapters. */
export function VisitQuestionPersistenceProbe() {
  const theme = createNextVisitQuestionsTheme(useColorScheme() === 'dark');
  const [repository, setRepository] = useState<RecordRepository | null>(null);
  const [index, setIndex] = useState(0);
  const [revision, setRevision] = useState(0);
  const [failure, setFailure] = useState(false);
  const [processInstance, setProcessInstance] = useState('');
  const [saved, setSaved] = useState<
    SavedQuestionsState<VisitQuestionEvidenceItem>
  >({ status: 'loading', questions: [] });
  const visit = visits[index]!;
  useEffect(() => {
    let active = true;
    (async () => {
      const records = await openLocalStorage();
      if (!(await getCipherVersion())) throw new Error('SQLCipher unavailable');
      const process = await NativeModules.OrotTestControl.speechSnapshot();
      if (
        typeof process.processInstance !== 'string' ||
        !process.processInstance
      )
        throw new Error('Native process observation unavailable');
      for (const appointment of visits)
        if (!(await records.get('appointment', appointment.id)))
          await records.put('appointment', appointment);
      if (active) {
        setProcessInstance(process.processInstance);
        setRepository(records);
      }
    })().catch(() => {
      if (active) setFailure(true);
    });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    if (!repository)
      return () => {
        active = false;
      };
    setSaved({ status: 'loading', questions: [] });
    (async () => {
      const database = await openLocalAgentMemoryDatabase();
      const result = await loadSavedVisitQuestionState({
        appointmentId: visit.id,
        records: repository,
        sourceReader: createLocalHealthEvidenceRepository(database),
        registry: new LocalEvidenceReferenceRegistry(),
      });
      if (active) setSaved(result);
    })().catch(() => {
      if (active) setFailure(true);
    });
    return () => {
      active = false;
    };
  }, [repository, visit.id, revision]);
  const save: Props['onSaveReviewedQuestions'] = async (
    appointment,
    questions,
    caveats,
    expectedSavedQuestions,
  ) => {
    if (!repository) throw new Error('Storage unavailable');
    const result = await saveReviewedVisitQuestions({
      appointmentId: appointment.id,
      expectedAppointmentRevision: localEvidenceFingerprint(appointment),
      questions,
      expectedSavedQuestions,
      evidence: {
        batch: { items: [], coverage: [], conflicts: [] },
        metadataByCitation: new Map(),
        memoryStatus: 'not_searched',
      },
      repository,
      now: new Date().toISOString(),
      revalidateEvidence: async references => references.length === 0,
    });
    // Reload through the actual restoration adapter so the native test can compare persisted IDs.
    setRevision(value => value + 1);
    return {
      questions: questions.map((question, position) => ({
        ...question,
        identity: {
          id: result.questions[position]!.id,
          expectedRevision: localEvidenceFingerprint(
            result.questions[position]!,
          ),
        },
      })),
      caveats,
      memoryStatus: result.memoryStatus,
    };
  };
  if (failure)
    return (
      <Text testID="visit-persistence-failure">
        Synthetic persistence failed
      </Text>
    );
  if (!repository)
    return (
      <Text testID="visit-persistence-loading">
        Preparing synthetic encrypted storage
      </Text>
    );
  return (
    <View style={styles.container}>
      <Text testID="visit-persistence-ready">SQLCipher ready · {visit.id}</Text>
      <Text testID="visit-persistence-process">{processInstance}</Text>
      <Text testID="visit-persistence-snapshot">
        {saved.status === 'ready'
          ? JSON.stringify(
              saved.questions.map(question => question.identity?.id),
            )
          : 'loading'}
      </Text>
      <Pressable
        testID="visit-persistence-switch"
        accessibilityRole="button"
        onPress={() => setIndex(value => 1 - value)}
      >
        <Text>Switch synthetic visit</Text>
      </Pressable>
      <NextVisitQuestionsScreen
        appointment={{ status: 'ready', appointment: visit }}
        provider={{
          status: 'available',
          selection: { providerId: 'synthetic', modelId: 'synthetic' },
          displayName: 'Synthetic',
          privacyBoundary: 'on-device',
        }}
        savedQuestions={saved}
        onGenerate={async () => ({
          status: 'ready',
          questions: candidates,
          caveats: [],
        })}
        onSaveReviewedQuestions={save}
        onOpenProviderSelection={() => undefined}
        onRefreshAppointment={() => undefined}
        onRetrySavedQuestions={() => setRevision(value => value + 1)}
        theme={theme}
      />
    </View>
  );
}

const styles = StyleSheet.create({ container: { flex: 1 } });
