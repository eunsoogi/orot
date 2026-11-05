import type { AiFeatureServices } from './featureServices';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { VisitQuestionEvidenceItem } from '../../agent/visitQuestions/taskContract';
import { operationRunId } from './featureRunIdentity';
import { parseHealthContextScope } from '../../healthEvidence/healthContext/scope';
import { referenceOnly } from '../../diseaseHypotheses/resultValidation';

/** Tool metadata gets bounded opaque identities while source reads validate the original evidence. */
export function createConversationVisitToolSource(
  registry: LocalEvidenceReferenceRegistry,
  register: AiFeatureServices['registerVisitQuestionSource'],
) {
  return (
    reference: VisitQuestionEvidenceItem,
    validate: (signal: AbortSignal) => Promise<boolean>,
  ) => {
    if (registry.resolve(reference)) return reference;
    const identity = referenceOnly(reference);
    const token = operationRunId();
    const period = parseHealthContextScope(identity.locator);
    const durable = {
      ...identity,
      sourceId: `visit-source-${token}`,
      evidenceId: `visit-evidence-${token}`,
      sourceRevision: period
        ? identity.sourceRevision
        : `visit-revision-${token}`,
      evidenceRevision: period
        ? identity.evidenceRevision
        : `visit-revision-${token}`,
    };
    return register(reference, validate, durable);
  };
}
