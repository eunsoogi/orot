import { fingerprint } from '../aiFeatures/integration/evidenceUtils';
import { conversationDailyReportText } from '../aiFeatures/integration/conversationDailyReportText';
import { projectGeneratedSummaryDetail } from './summaryDetail';
import { createManualHistoryRepository, type SqlDatabase } from '@orot/storage';
import { createConversationArtifactStorage } from '../storage/conversationArtifactStorage';
import { validateDailyReportArtifact } from '../storage/dailyReportArtifactValidation';
import { createSymptomSummaryPersistence } from '../aiFeatures/integration/symptomSummaryPersistence';
import { LocalEvidenceReferenceRegistry } from '../aiFeatures/integration/evidenceRegistry';
const openAiFeatureLocalData = async () =>
  (
    await import('../aiFeatures/integration/localData')
  ).openAiFeatureLocalData();
import { loadSavedVisitQuestionState } from '../aiFeatures/integration/savedVisitQuestions';
const openLocalStorage = async () =>
  (await import('../storage/secureDatabase')).openLocalStorage();
const openLocalAgentMemoryDatabase = async () =>
  (await import('../storage/secureDatabase')).openLocalAgentMemoryDatabase();
import { createSymptomSummaryStorage } from '../storage/symptomSummaryStorage';
import { listGeneratedReports } from './catalog';
import type {
  GeneratedReportReader,
  GeneratedReportRow,
  GeneratedReportDetail,
} from './types';
import { generatedReportCopy as copy } from './text';

/** Each selection gets fresh source restoration. No model is selected, called, or given history. */
export function createGeneratedReportReader(
  database: SqlDatabase,
  dependencies = { data: openAiFeatureLocalData, records: openLocalStorage },
): GeneratedReportReader & {
  readBookmarkedDiseasePossibilities(
    id: string,
    current: () => boolean,
  ): Promise<GeneratedReportDetail | null>;
} {
  const bookmarks = createConversationArtifactStorage(database);
  return {
    async readBookmarkedDiseasePossibilities(id, current) {
      const revision = await bookmarks.readSavedDiseasePossibilitiesPin(
        id,
        current,
      );
      if (!revision || !current()) return null;
      const saved = await openSummaryReader(
        database,
        new LocalEvidenceReferenceRegistry(),
        dependencies.data,
      ).readCommittedStatus(id);
      if (
        !saved ||
        'status' in saved ||
        saved.revision !== revision ||
        saved.analysis.presentation !== undefined ||
        saved.analysis.savedSummary?.status !== 'saved' ||
        saved.analysis.savedSummary.id !== id ||
        saved.analysis.savedSummary.sourceChanged ||
        !current()
      )
        return null;
      // Keep the original review warnings, then revalidate the exact retained
      // snapshot after those source reads; never publish their stale result.
      const verified = await bookmarks.readSavedDiseasePossibilitiesReference(
        id,
        current,
      );
      return current() && verified && fingerprint(verified) === revision
        ? projectGeneratedSummaryDetail(saved.analysis)
        : null;
    },
    list: before => listGeneratedReports(database, before),
    async read(row, signal) {
      if (signal.aborted) return null;
      const result = await readSelected(database, row, signal, dependencies);
      return signal.aborted ? null : result;
    },
  };
}
async function readSelected(
  database: SqlDatabase,
  row: GeneratedReportRow,
  signal: AbortSignal,
  dependencies: {
    data: typeof openAiFeatureLocalData;
    records: typeof openLocalStorage;
  },
): Promise<GeneratedReportDetail | null> {
  if (row.origin === 'conversation') {
    const saved = await createConversationArtifactStorage(database).read(
      row.id,
    );
    if (
      !saved ||
      saved.entryIntent !== 'possibilities' ||
      saved.status !== 'complete'
    )
      return null;
    return { paragraphs: [saved.answer] };
  }
  if (row.kind === 'daily_report') {
    // Superseded and invalidated runs share a tombstone. Never guess the reason or
    // substitute the current head for the selected historical run.
    const state: {
      result: Awaited<ReturnType<typeof validateDailyReportArtifact>>;
    } = { result: null };
    await database.transaction(async tx => {
      state.result = await validateDailyReportArtifact(
        tx,
        row.id,
        createManualHistoryRepository(database),
        true,
      );
    });
    if (!state.result) return null;
    return {
      paragraphs: [
        conversationDailyReportText({ status: 'saved', ...state.result }),
      ],
      daily: state.result.report,
      warning: copy.coverage,
    };
  }
  const registry = new LocalEvidenceReferenceRegistry();
  if (row.origin === 'visit') {
    const data = await dependencies.data();
    const saved = await loadSavedVisitQuestionState({
      appointmentId: row.id,
      records: await dependencies.records(),
      sourceReader: data.repository,
      registry,
      readHealthContext: data.readHealthContext,
      data,
    });
    if (saved.status !== 'ready' || saved.questions.length === 0) return null;
    return {
      paragraphs: saved.questions.flatMap(q => [q.questionText, q.rationale]),
      warning: saved.restorationNotice,
    };
  }
  const saved = await openSummaryReader(
    database,
    registry,
    dependencies.data,
  ).readCommittedStatus(row.id);
  if (!saved || 'status' in saved) return null;
  const original = saved.analysis.savedSummary;
  // A same-looking Conversation answer or a preview never supplies a pin capability.
  const bookmarkOriginal =
    row.origin === 'summary' &&
    row.kind === 'possibilities' &&
    row.key === `summary:${row.id}` &&
    !row.unavailable &&
    saved.analysis.presentation === undefined &&
    original?.status === 'saved' &&
    original.id === row.id &&
    !original.sourceChanged
      ? (current: () => boolean) =>
          createConversationArtifactStorage(
            database,
          ).bookmarkDiseasePossibilities({
            id: row.id,
            revision: saved.revision,
            current: () => !signal.aborted && current(),
          })
      : undefined;
  return {
    ...projectGeneratedSummaryDetail(saved.analysis),
    ...(bookmarkOriginal ? { bookmarkOriginal } : {}),
  };
}
function openSummaryReader(
  database: SqlDatabase,
  registry: LocalEvidenceReferenceRegistry,
  data: typeof openAiFeatureLocalData,
) {
  return createSymptomSummaryPersistence({
    registry,
    data,
    storage: async () => createSymptomSummaryStorage(database),
  });
}
/** Storage opens lazily when the Records browser is used, not during application import. */
export async function openGeneratedReportReader() {
  return createGeneratedReportReader(await openLocalAgentMemoryDatabase());
}
