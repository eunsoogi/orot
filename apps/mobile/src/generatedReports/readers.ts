import { fingerprint } from '../aiFeatures/integration/evidenceUtils';
import { dailyReportPresentation } from '../aiFeatures/integration/conversationDailyReportText';
import { savedHistoricalReadAdmission } from './savedReportNativeProtection';
import { readSavedHealthSummaryDetail } from './savedHealthSummaryDetail';
import { projectGeneratedSummaryDetail } from './summaryDetail';
import { readConversationReportEvidence } from './conversationReportEvidence';
import type { SelectedPossibilityAdmission } from './selectedPossibilityAdmission';
import { createArchivedCitationService } from '../aiFeatures/integration/archivedCitationService';
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
import { createSymptomSummaryStorage } from '../storage/symptomSummaryStorage';
import { listGeneratedReports } from './catalog';
import { protectedConversationCatalogRemoval } from './protectedConversationCatalogRemoval';
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
  isCurrentDatabase?: SelectedPossibilityAdmission['isCurrentDatabase'],
): GeneratedReportReader & {
  readBookmarkedDiseasePossibilities(
    id: string,
    current: () => boolean,
  ): Promise<GeneratedReportDetail | null>;
} {
  const bookmarks = createConversationArtifactStorage(database);
  return {
    archivedSources: createArchivedCitationService(async () => ({
      ...(await dependencies.data()),
      // Resolve and recheck the same protected database that admitted the report.
      openConversationArtifactStorage: async () => bookmarks,
    })),
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
    ...(isCurrentDatabase && {
      prepareCatalogRemoval: protectedConversationCatalogRemoval(
        database,
        isCurrentDatabase,
      ),
    }),
    list: before => listGeneratedReports(database, before),
    async read(row, signal, onHistoricalProtectionLost) {
      if (signal.aborted) return null;
      const admission =
        onHistoricalProtectionLost &&
        savedHistoricalReadAdmission(signal, onHistoricalProtectionLost);
      let displayed = false;
      try {
        const result = await readSelected(
          database,
          row,
          signal,
          dependencies,
          admission?.confirm,
          isCurrentDatabase && onHistoricalProtectionLost
            ? { isCurrentDatabase, retireSelection: onHistoricalProtectionLost }
            : undefined,
        );
        displayed = !signal.aborted && result !== null;
        return displayed ? result : null;
      } finally {
        if (!displayed) admission?.dispose();
      }
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
  confirmHistorical?: () => Promise<boolean>,
  possibilityAdmission?: SelectedPossibilityAdmission,
): Promise<GeneratedReportDetail | null> {
  if (row.origin === 'conversation') {
    return readConversationReportEvidence(
      database,
      row,
      signal,
      possibilityAdmission,
    );
  }
  if (row.kind === 'health_summary')
    return row.origin === 'summary'
      ? readSavedHealthSummaryDetail(
          database,
          row,
          signal,
          dependencies.data,
          confirmHistorical,
        )
      : null;
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
      paragraphs: [],
      dailyReport: dailyReportPresentation({
        status: 'saved',
        ...state.result,
      }),
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
      paragraphs: [],
      // Keep the stored order and wording, without transferring source or edit authority.
      visitQuestions: saved.questions.map(question => ({
        id: question.identity.id,
        questionText: question.questionText,
        rationale: question.rationale,
        priority: question.priority,
      })),
      warning: saved.restorationNotice,
    };
  }
  const saved = await openSummaryReader(
    database,
    registry,
    dependencies.data,
  ).readCommittedStatus(row.id);
  if (
    !saved ||
    'status' in saved ||
    saved.analysis.presentation === 'symptom_summary'
  )
    return null;
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
  const { openLocalAgentMemoryDatabase, isCurrentLocalAgentMemoryDatabase } =
    await import('../storage/secureDatabase');
  return createGeneratedReportReader(
    await openLocalAgentMemoryDatabase(),
    undefined,
    isCurrentLocalAgentMemoryDatabase,
  );
}
