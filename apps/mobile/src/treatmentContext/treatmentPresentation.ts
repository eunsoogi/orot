import type { SqlDatabase } from '@orot/storage';
import type { ConversationArtifact } from '../storage/conversationArtifactCodec';
import {
  fingerprint,
  stableJson,
} from '../aiFeatures/integration/evidenceUtils';
import type { TreatmentEvidenceRequest } from './interfaces';
import type { TreatmentSafetyResult } from './treatmentSafetyBoundary';
import { verifiedTreatmentSources } from './treatmentSourceLinks';
import type { VerifiedTreatmentSource } from './treatmentSourceLinks';
import { explainTreatmentEducation } from './treatmentEducation';
import { treatmentSafetyKo } from '../i18n/treatmentSafety';

export interface TreatmentPresentation {
  readonly ownerIsCurrent?: () => boolean;
  readonly onVerified: (
    sources: readonly VerifiedTreatmentSource[],
    general: readonly string[],
  ) => void;
}

/** Keep checked general copy separate from cited record statements and recheck the owner after reads. */
export async function presentTreatment(input: {
  readonly database: SqlDatabase;
  readonly bound: TreatmentEvidenceRequest;
  readonly result: TreatmentSafetyResult;
  readonly presentation?: TreatmentPresentation;
  readonly signal: AbortSignal;
  readonly read: (id: string) => Promise<ConversationArtifact | null>;
  readonly artifactId?: string;
  readonly expectedRevision?: string;
}): Promise<TreatmentSafetyResult> {
  const { result, presentation, signal, database, bound, read, artifactId } =
    input;
  if (result.status !== 'validated' || !presentation) return result;
  const withheld = () => ({
    status: 'withheld' as const,
    reason: signal.aborted ? ('cancelled' as const) : ('unsupported' as const),
  });
  const artifact = artifactId ? await read(artifactId) : null;
  const revision = artifact && fingerprint(artifact);
  if (
    artifactId &&
    (!artifact ||
      (input.expectedRevision
        ? revision !== input.expectedRevision
        : artifact.answer !== result.claims[0]?.text ||
          stableJson(artifact.citations) !==
            stableJson(result.claims[0]?.citations) ||
          stableJson(artifact.treatmentContext) !== stableJson(bound.context)))
  )
    return withheld();
  const ownerIsCurrent = async () => {
    if (presentation.ownerIsCurrent?.() === false) return false;
    if (!artifactId) return true;
    const latest = await read(artifactId);
    return Boolean(
      latest &&
      fingerprint(latest) === revision &&
      presentation.ownerIsCurrent?.() !== false,
    );
  };
  const general: string[] = [];
  const kinds =
    result.claims[0]?.text ===
    treatmentSafetyKo['treatmentSafety.hypertensionOverview']
      ? []
      : bound.context.conditions.length
        ? (['general_options', 'benefits_risks'] as const)
        : (['benefits_risks'] as const);
  for (const kind of kinds) {
    const education = await explainTreatmentEducation(
      database,
      bound,
      { kind },
      signal,
      [],
    );
    if (education.status !== 'validated') return withheld();
    general.push(...education.claims.map(claim => claim.text));
  }
  if (signal.aborted || !(await ownerIsCurrent())) return withheld();
  presentation.onVerified(
    verifiedTreatmentSources(database, bound, result.claims, ownerIsCurrent),
    general,
  );
  return result;
}
