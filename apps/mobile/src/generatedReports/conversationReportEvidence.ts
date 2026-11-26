import type { SqlDatabase } from '@orot/storage';
import { stableJson } from '../aiFeatures/integration/evidenceUtils';
import { isConversationPhotoSource } from '../conversationTools/conversationArtifactSources';
import {
  possibilityReportTemplate,
  parsePossibilityConversationReport,
} from '../ragConversation/conversationReportTemplate';
import { savedPossibilityNarrativeParts } from '../ragConversation/savedPossibilityNarrativeParts';
import { projectSavedArchivedCitations } from '../ragConversation/savedArchivedCitations';
import { createConversationArtifactStorage } from '../storage/conversationArtifactStorage';
import type { GeneratedReportDetail, GeneratedReportRow } from './types';
import {
  holdSelectedPossibilityAdmission,
  type SelectedPossibilityAdmission,
} from './selectedPossibilityAdmission';
import { savedReportPublicCitationUrl } from './savedReportPublicCitation';

/** Bind the already selected answer to its exact durable lease. No source
 * lookup or provider work is started by projecting compact pill metadata. */
export async function readConversationReportEvidence(
  database: SqlDatabase,
  row: GeneratedReportRow,
  signal: AbortSignal,
  admission?: SelectedPossibilityAdmission,
): Promise<GeneratedReportDetail | null> {
  if (
    row.kind !== 'possibilities' ||
    row.key !== `conversation:${row.id}` ||
    row.unavailable ||
    signal.aborted
  )
    return null;
  const storage = createConversationArtifactStorage(
    database,
    admission?.isCurrentDatabase,
  );
  await storage.currentGeneration();
  const lease = await database.execute(
    `SELECT a.session_id, s.version,
       CASE WHEN json_valid(a.result_json) THEN json_type(a.result_json, '$.possibilityOriginal') END AS typed_original
       FROM conversation_artifacts a
       JOIN conversation_artifact_sessions s ON s.id = a.session_id AND s.hidden = 0
       JOIN conversation_artifact_generation g ON g.singleton = 1 AND s.generation = g.generation
       WHERE a.id = ? AND a.created_at = ?`,
    [row.id, row.createdAt],
  );
  const sessionId = lease.rows[0]?.session_id;
  const sessionVersion = lease.rows[0]?.version;
  if (
    typeof sessionId !== 'string' ||
    typeof sessionVersion !== 'number' ||
    !Number.isSafeInteger(sessionVersion) ||
    sessionVersion < 0 ||
    signal.aborted
  )
    return null;
  const typed = lease.rows[0]?.typed_original != null;
  const proof = typed
    ? holdSelectedPossibilityAdmission(database, signal, admission)
    : undefined;
  let keep = false;
  try {
    if (typed && (!proof || !(await proof.confirm()) || !proof.current()))
      return null;
    let saved: Awaited<ReturnType<typeof storage.read>>;
    try {
      [saved = null] = await storage.readSessionMany(
        sessionId,
        sessionVersion,
        [row.id],
      );
    } catch (error) {
      // A hide/clear/undo cannot rebind to whichever version happens to be active now.
      if ((await storage.activeSessionVersion(sessionId)) !== sessionVersion)
        return null;
      throw error;
    }
    if (
      !saved ||
      signal.aborted ||
      saved.status !== 'complete' ||
      saved.entryIntent !== 'possibilities' ||
      saved.createdAt !== row.createdAt ||
      saved.sessionId !== sessionId ||
      saved.healthSummary ||
      saved.dailyReport ||
      saved.visitQuestions
    )
      return null;
    if (Boolean(saved.possibilityOriginal) !== typed) return null;
    const exact =
      proof &&
      (await storage.readPossibilityOriginal({
        artifactId: row.id,
        createdAt: row.createdAt,
        lease: { id: sessionId, version: sessionVersion },
        current: proof.current,
        confirmProtected: proof.confirm,
      }));
    if (
      proof &&
      (!exact ||
        !proof.renderCurrent() ||
        exact.revision !== saved.possibilityOriginal?.revision)
    )
      return null;
    const template = exact && possibilityReportTemplate();
    const report =
      exact && template
        ? {
            title: template.title,
            sections: template.sections.map((title, index) => ({
              title,
              content:
                exact.sections[index]! +
                (index === template.sections.length - 1 ? exact.trailing : ''),
            })),
          }
        : parsePossibilityConversationReport(saved.answer);
    if (!report)
      return {
        paragraphs: [saved.answer],
        ...(savedPossibilityNarrativeParts(saved.answer)
          ? { savedPossibilityNarrative: true }
          : {}),
      };
    // These are the same protected references the strict read just admitted.
    // Only one exact non-photo match may be offered to the archived selector.
    const matches = new Map<string, number>();
    for (const source of saved.sources) {
      if (isConversationPhotoSource(source)) continue;
      const key = stableJson(source.reference);
      matches.set(key, (matches.get(key) ?? 0) + 1);
    }
    const references = saved.citations ?? [];
    const citations = projectSavedArchivedCitations(references).filter(item => {
      const ref = references[item.ordinal];
      return (
        ref &&
        matches.get(stableJson(ref)) === 1 &&
        (item.kind === 'personal_record' ||
          savedReportPublicCitationUrl(item, ref) !== undefined)
      );
    });
    keep = true;
    return {
      paragraphs: [],
      ...(proof ? { possibilityOriginalCurrent: proof.renderCurrent } : {}),
      conversationPossibility: report,
      ...(citations.length
        ? {
            conversationSources: {
              target: {
                sessionId,
                sessionVersion,
                turnId: row.id,
                createdAt: row.createdAt,
              },
              citations,
            },
          }
        : {}),
    };
  } finally {
    if (!keep) proof?.dispose();
  }
}
