import type { ExecutionConsentPort } from '@orot/agent-runtime';
import type { TranscriptEvidenceSegment } from '@orot/domain';

let automaticRecap: ReturnType<
  typeof import('./automaticRecapService').createAutomaticRecapService
> | null = null;
let foregroundConsent: ExecutionConsentPort | null = null;

/** Only a mounted foreground surface may authorize transmission of the exact payload. */
export function setRecapForegroundConsent(
  consent: ExecutionConsentPort | null,
) {
  foregroundConsent = consent;
}

/** Processing survives route removal, but remote requests require foreground consent. */
export async function completeProductionRecap(
  sourceId: string,
  segments: readonly TranscriptEvidenceSegment[],
  signal: AbortSignal,
) {
  const { openLocalAgentMemoryDatabase } =
    await import('../storage/secureDatabase');
  const { createAutomaticRecapService } =
    await import('./automaticRecapService');
  const database = await openLocalAgentMemoryDatabase();
  automaticRecap ??= createAutomaticRecapService(database, {
    async authorize(request) {
      if (!request.remoteProcessing) return 'authorized';
      const surface = foregroundConsent;
      if (!surface) return 'renewal_required';
      const decision = await surface.authorize(request);
      return foregroundConsent === surface ? decision : 'renewal_required';
    },
  });
  await automaticRecap(sourceId, segments, signal);
}
