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

/** Restore a computed source from its fixed scope and revision, never from the saved AI question text. */
export async function restoreVisitQuestionHealthContext(
  source: VisitQuestionHealthContextSource,
  read: HealthContextReader | undefined,
  registry: LocalEvidenceReferenceRegistry,
) {
  const parsed = VisitQuestionHealthContextSourceSchema.safeParse(source);
  const scope = parsed.success && parseHealthContextScope(parsed.data.scope);
  if (!scope || !read)
    throw new SavedVisitQuestionsReadError('changed_health_context');
  const report = await read(scope.window, [scope.topic]);
  if (healthContextRevision(scope, report) !== source.revision)
    throw new SavedVisitQuestionsReadError('changed_health_context');
  // Unrelated deletions may advance the global generation; exact historical facts must still match.
  return registerHealthContextEvidence({
    registry,
    read,
    scope,
    report,
    expectedRevision: source.revision,
  });
}
