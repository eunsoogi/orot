import type { HistoricalDialogueParent } from '../../storage/protectedPromptHistory';
import {
  parseColdDialogueParents,
  type ColdDialogueCurrent,
} from './coldPromptDialogue';
import type { EvidenceReference } from '@orot/agent-runtime';
import type { JsonObject } from '@orot/model-runtime';
import type { ConversationEntryContext } from './conversationIntent';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';

export interface ColdRagCompletion {
  version: 1 | 2;
  historicalDialogueParents?: readonly HistoricalDialogueParent[];
  entryContext: ConversationEntryContext | null;
  priorDialogue: readonly { question: string; answer: string }[];
  priorUserReports: readonly string[];
  priorDialogueOmitted?: boolean;
  historySources: readonly EvidenceReference[];
  reportReferences: readonly EvidenceReference[];
  localRetrievalFailed: boolean;
}

/** Completion lineage comes from protected live capture, never from regenerated model history. */
export async function readColdRagCompletion(
  reconstruction: JsonObject,
  registry: LocalEvidenceReferenceRegistry,
  signal: AbortSignal,
  dialogueCurrent?: ColdDialogueCurrent,
): Promise<ColdRagCompletion> {
  const saved = reconstruction.completion as unknown as ColdRagCompletion;
  if (
    !saved ||
    (saved.version !== 1 && saved.version !== 2) ||
    !Array.isArray(saved.priorDialogue) ||
    saved.priorDialogue.some(
      turn =>
        !turn ||
        typeof turn.question !== 'string' ||
        typeof turn.answer !== 'string',
    ) ||
    !Array.isArray(saved.priorUserReports) ||
    saved.priorUserReports.some(value => typeof value !== 'string') ||
    (saved.priorDialogueOmitted !== undefined &&
      typeof saved.priorDialogueOmitted !== 'boolean') ||
    !Array.isArray(saved.historySources) ||
    !Array.isArray(saved.reportReferences) ||
    typeof saved.localRetrievalFailed !== 'boolean' ||
    (saved.entryContext !== null &&
      (!saved.entryContext ||
        typeof saved.entryContext.entryKey !== 'string' ||
        ![
          'conversation',
          'health-summary',
          'possibilities',
          'visit-questions',
          'medical-literature',
        ].includes(saved.entryContext.intent)))
  )
    throw new Error('Cold completion inputs unavailable.');
  if (saved.version === 1 && saved.historicalDialogueParents !== undefined)
    throw new Error('Unexpected legacy dialogue scope.');
  if (saved.version === 2) {
    const parents = parseColdDialogueParents(saved.historicalDialogueParents);
    if (
      !parents ||
      parents.length !== saved.priorDialogue.length ||
      saved.historySources.length ||
      !dialogueCurrent ||
      !(await dialogueCurrent(signal, parents))
    )
      throw new Error('Cold dialogue ownership changed.');
  }
  const sources = [...saved.historySources, ...saved.reportReferences];
  if (
    signal.aborted ||
    sources.some(source => !source || !registry.resolve(source)) ||
    (sources.length && !(await registry.revalidateEvidence(sources, signal))) ||
    signal.aborted
  )
    throw new Error('Cold completion lineage changed.');
  return JSON.parse(JSON.stringify(saved));
}
