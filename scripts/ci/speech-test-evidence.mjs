import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateSyntheticSpeech } from '../../apps/mobile/src/transcription/accuracyEvaluation.ts';

export function verifySpeechObservations(observations, fixture) {
  if (
    observations.length !== fixture.cases.length ||
    new Set(observations.map((item) => item.id)).size !== fixture.cases.length
  )
    throw new Error('iOS Korean observations are missing or repeated');
  return fixture.cases.map((testCase) => {
    const observed = observations.find((item) => item.id === testCase.id);
    if (
      !observed ||
      observed.inputSha256 !== testCase.audio.sha256 ||
      observed.expectedText !== testCase.expectedText ||
      observed.serviceResult !== true ||
      observed.syntheticAudio !== true ||
      typeof observed.recognizedText !== 'string' ||
      !observed.recognizedText.trim()
    )
      throw new Error('iOS Speech fixture provenance mismatch');
    if (
      !['speech_transcriber', 'dictation_transcriber', 'on_device_speech_recognizer'].includes(
        observed.engine,
      )
    )
      throw new Error('Missing actual Apple Speech engine');
    const accuracy = evaluateSyntheticSpeech(testCase, observed.recognizedText);
    if (!Number.isFinite(accuracy.characterErrorRate))
      throw new Error('Missing measured Speech accuracy');
    // Accuracy is an observed metric, as in the original fixture report. A wrong
    // medication name remains visible rather than being overwritten by expected text.
    return { ...observed, accuracy };
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, output] = process.argv.slice(2);
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
  const observations = [];
  for (const test of manifest) {
    for (const attachment of test.attachments ?? []) {
      if (!attachment.suggestedHumanReadableName?.startsWith('speech-korean-')) continue;
      const name = attachment.exportedFileName;
      if (typeof name !== 'string' || name !== basename(name))
        throw new Error('Invalid Speech attachment path');
      observations.push(JSON.parse(readFileSync(join(directory, name), 'utf8')));
    }
  }
  const fixture = JSON.parse(
    readFileSync(
      new URL(
        '../../apps/mobile/e2e/transcription/fixtures/synthetic-korean.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const measured = verifySpeechObservations(observations, fixture);
  writeFileSync(
    output,
    JSON.stringify({ syntheticAudio: true, serviceResult: true, cases: measured }, null, 2) + '\n',
  );
  console.log(`SPEECH_TEST_EVIDENCE_VERIFIED fixtures=${measured.length}`);
}
