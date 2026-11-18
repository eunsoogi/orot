import { createRecapForegroundConsent } from './recapForegroundConsent';
import type { ExecutionConsentPort } from '@orot/agent-runtime';
import type { TranscriptEvidenceSegment } from '@orot/domain';

let automaticRecap: ReturnType<
  typeof import('./automaticRecapService').createAutomaticRecapService
> | null = null;
const foreground = createRecapForegroundConsent();

/** Only a mounted foreground surface may authorize transmission of the exact payload. */
export function setRecapForegroundConsent(
  consent: ExecutionConsentPort | null,
) {
  foreground.set(consent);
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
  automaticRecap ??= createAutomaticRecapService(database, foreground.consent);
  await automaticRecap(sourceId, segments, signal);
}
