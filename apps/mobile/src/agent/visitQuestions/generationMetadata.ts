import { VisitQuestionGenerationSchema } from '@orot/domain';
import type {
  VisitQuestionCaveat,
  VisitQuestionGeneration,
} from '@orot/domain';
import { fingerprintConsentSnapshot } from '../execution/consentFingerprint';
import type { VisitQuestionCandidate } from './taskContract';

/** Capture only exact locally validated versions; no raw evidence is copied into the saved question. */
export async function captureQuestionGeneration(
  question: VisitQuestionCandidate,
  caveats: readonly VisitQuestionCaveat[],
): Promise<VisitQuestionGeneration> {
  const sources = await Promise.all(
    [...question.citations, ...(question.generatedArtifactContext ?? [])].map(
      async source => ({
        sourceKind: source.sourceKind,
        sourceId: source.sourceId,
        evidenceId: source.evidenceId,
        sourceDigest: await fingerprintConsentSnapshot(source.sourceRevision),
        evidenceDigest: await fingerprintConsentSnapshot(
          source.evidenceRevision,
        ),
      }),
    ),
  );
  return VisitQuestionGenerationSchema.parse({
    version: 1,
    caveats: [...new Set(caveats)],
    sources,
  });
}
