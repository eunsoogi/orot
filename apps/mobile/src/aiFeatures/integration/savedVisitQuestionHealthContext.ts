import { VisitQuestionHealthContextSourceSchema } from '@orot/domain';
import type { VisitQuestionHealthContextSource } from '@orot/domain';
import type { HealthContextReader } from '../../healthEvidence/healthContext/reader';
import {
  healthContextRevision,
  parseHealthContextScope,
} from '../../healthEvidence/healthContext/scope';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { registerHealthContextEvidence } from './healthContextEvidence';
import { SavedVisitQuestionsReadError } from './savedVisitQuestionCitation';
import { completeVisitHealthContextFacts } from '../../agent/visitQuestions/healthContextFacts';
import { fingerprint } from './evidenceUtils';

async function readPeriod(
  source: VisitQuestionHealthContextSource,
  read: HealthContextReader | undefined,
) {
  const parsed = VisitQuestionHealthContextSourceSchema.safeParse(source);
  const scope = parsed.success && parseHealthContextScope(parsed.data.scope);
  if (!scope || !read)
    throw new SavedVisitQuestionsReadError('changed_health_context');
  const report = await read(scope.window, [scope.topic]);
  return { scope, report, read };
}

function registerCurrentPeriod(
  source: VisitQuestionHealthContextSource,
  { scope, report, read }: Awaited<ReturnType<typeof readPeriod>>,
  registry: LocalEvidenceReferenceRegistry,
) {
  // Unrelated deletions may advance the global generation; exact historical facts must still match.
  const item = registerHealthContextEvidence({
    registry,
    read,
    scope,
    report,
    expectedRevision: source.revision,
  });
  return {
    ...item,
    content: registry.redactText(
      completeVisitHealthContextFacts(scope, report),
    ),
  };
}

/** Restore a computed source from its fixed scope and revision, never from the saved AI question text. */
export async function restoreVisitQuestionHealthContext(
  source: VisitQuestionHealthContextSource,
  read: HealthContextReader | undefined,
  registry: LocalEvidenceReferenceRegistry,
) {
  const current = await readPeriod(source, read);
  if (healthContextRevision(current.scope, current.report) !== source.revision)
    throw new SavedVisitQuestionsReadError('changed_health_context');
  return registerCurrentPeriod(source, current, registry);
}

/** History may show the reviewed question after additions/updates, but a changed source is never reusable evidence. */
export async function restoreVisitQuestionPeriodForHistory(
  source: VisitQuestionHealthContextSource,
  read: HealthContextReader | undefined,
  registry: LocalEvidenceReferenceRegistry,
) {
  const current = await readPeriod(source, read);
  if (healthContextRevision(current.scope, current.report) === source.revision)
    return {
      item: registerCurrentPeriod(source, current, registry),
      changed: false,
    };
  // Without the same deletion generation, a version mismatch could hide a removed contributor.
  // Deletion guards remain authoritative; this fallback only preserves reviewed history after non-deleting changes.
  if (current.report.deletionGeneration !== source.deletionGeneration)
    throw new SavedVisitQuestionsReadError('changed_health_context');
  const id = `changed-health-context-${fingerprint(source)}`;
  return {
    changed: true,
    item: registry.add({
      reference: {
        sourceKind: 'personal_record',
        sourceId: id,
        sourceRevision: source.revision,
        evidenceId: id,
        evidenceRevision: source.revision,
        locator: { ...current.scope, window: { ...current.scope.window } },
        effectiveTime: null,
        reviewState: 'unknown',
      },
      // Do not attach today's facts to an older revision or reconstruct an original from model prose.
      content:
        '생성 당시의 건강 근거가 바뀌었어요. 최신 기록으로 질문을 다시 생성해 주세요.',
      readSource: async () => ({ status: 'changed' }),
      validate: async () => false,
    }),
  };
}
