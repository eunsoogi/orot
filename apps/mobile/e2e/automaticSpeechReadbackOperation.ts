import { createTranscriptEvidenceService } from '../src/transcription/transcriptEvidenceService';
import {
  cleanupAutomaticProbeSource,
  readAutomaticProbeSource,
} from './automaticTranscriptionProbeSupport';

/** A fresh app host reads the exact UI-created source through production SQL and service code. */
export async function readAutomaticSpeechAfterRestart(sourceId: unknown) {
  if (typeof sourceId !== 'string' || !/^[0-9a-f-]{36}$/i.test(sourceId))
    throw new Error('Speech restart requires the UI-created source identifier');
  const persisted = await readAutomaticProbeSource(sourceId);
  // This is the real provider. Existing segments must short-circuit recognition; native engine counts prove it.
  const service = createTranscriptEvidenceService();
  const loaded = await service.load(sourceId);
  const reused = await service.transcribe(sourceId);
  if (!loaded)
    throw new Error('Speech restart did not load its saved recording');
  return { ...persisted, loaded, reused };
}

export async function cleanupAutomaticSpeechAfterRestart(sourceId: unknown) {
  if (typeof sourceId !== 'string')
    throw new Error('A source identifier is required');
  await cleanupAutomaticProbeSource(sourceId);
  return { cleaned: true };
}
