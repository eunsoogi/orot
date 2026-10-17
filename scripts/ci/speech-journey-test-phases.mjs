import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { speechJourneyTests } from './ios-test-config.mjs';

function nativeObservation(receipt) {
  const native = receipt?.nativeObservation;
  if (
    !Number.isSafeInteger(native?.processIdentifier) ||
    native.processIdentifier <= 0 ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(native.processInstance ?? '')
  )
    throw new Error('Speech journey requires the actual app process identity');
  return native;
}

/** The UI saves once; the next invocation receives its observed baseline and must use a different app process. */
export async function executeSpeechJourneyPhases(run) {
  const saved = await run(speechJourneyTests[0]);
  const first = nativeObservation(saved);
  if (first.speechRequests !== 1 || saved?.providerCalls !== 1 || !saved?.source?.id)
    throw new Error('Speech UI did not save exactly one real native recognition');
  const restored = await run(speechJourneyTests[1], saved);
  const second = nativeObservation(restored);
  if (
    second.processIdentifier === first.processIdentifier ||
    second.processInstance === first.processInstance
  )
    throw new Error('Speech persistence requires a new app process');
  if (second.speechRequests !== 0 || restored.sourceId !== saved.source.id)
    throw new Error('Speech restart changed its source or started new recognition');
  return [saved, restored];
}

/** Only the exact first-run test attachment from the owned destination can supply the next process's baseline. */
export function readSpeechJourneyAttachment(directory, identifier, udid, name) {
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
  const testName = identifier.split('/').slice(1).join('/') + '()';
  const matches = manifest
    .filter((entry) => entry.testIdentifier === testName)
    .flatMap((entry) => entry.attachments)
    .filter((attachment) => attachment.suggestedHumanReadableName?.startsWith(name + '_'));
  if (
    matches.length !== 1 ||
    matches[0].deviceId !== udid ||
    !/^[a-f0-9-]{36}\.json$/i.test(matches[0].exportedFileName)
  )
    throw new Error('Missing, duplicate or foreign Speech journey attachment');
  return JSON.parse(readFileSync(join(directory, matches[0].exportedFileName), 'utf8'));
}
