import { conversationDailyReportText } from '../aiFeatures/integration/conversationDailyReportText';
import { readableHypothesis } from '../diseaseHypotheses/readableHypothesis';
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
): GeneratedReportReader {
  return {
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
  const saved = await createSymptomSummaryPersistence({
    registry,
    data: dependencies.data,
    storage: async () => createSymptomSummaryStorage(database),
  }).history.readStatus!(row.id);
  if (!saved || 'status' in saved) return null;
  return {
    analysis: saved.analysis,
    paragraphs: saved.analysis.hypotheses
      .map(readableHypothesis)
      .flatMap(h => [h.title, h.summary, h.uncertainty, ...h.missingData]),
    warning:
      saved.analysis.savedSummary?.status === 'saved' &&
      saved.analysis.savedSummary.sourceChanged
        ? copy.changed
        : copy.coverage,
  };
}
/** Storage opens lazily when the Records browser is used, not during application import. */
export async function openGeneratedReportReader() {
  return createGeneratedReportReader(await openLocalAgentMemoryDatabase());
}
