/* global by, device, element, waitFor, describe, it */

const { expect: jestExpect } = require('@jest/globals');
const {
  accessibilityText,
  cleanupTranscriptEvidenceIfPresent,
  failureDescription,
  scrollToSaveButton,
  scrollToStaleArtifactNotice,
  scrollToTranscriptControl,
  waitForProbeControl,
} = require('./transcription/transcriptEvidenceDetoxHelpers');
const { runRecordingExportScenario } = require('./recordingExport.e2e');
const {
  runTranscriptDeletionAssertion,
} = require('./transcription/transcriptDeletionDetoxHelpers');
const {
  switchToTranscriptEvidenceMode,
} = require('./transcription/transcriptProbeModeDetoxHelpers');

describe('Apple Korean transcription and recording export on iOS Simulator', () => {
  it('records transcript evidence and verifies saved recording exports', async () => {
    // Grant only speech recognition on this dedicated Simulator so the legacy API never pauses for a system alert.
    await device.launchApp({
      newInstance: true,
      permissions: { speech: 'YES' },
    });
    // Speech can keep the Simulator run loop active while the provider reports its terminal result.
    await device.disableSynchronization();
    const nativeProbeFailure = await switchToTranscriptEvidenceMode({
      by,
      device,
      element,
      waitFor,
    });

    let assertionFailure;
    let assertionStage = 'open evidence setup';
    try {
      await element(by.id('transcript-evidence-open')).tap();
      const setupStatus = element(by.id('transcript-evidence-setup-status'));
      assertionStage = 'wait for recording setup';
      await waitFor(setupStatus).toHaveText('ready').withTimeout(30000);
      assertionStage = 'reveal transcript panel';
      await waitFor(element(by.id('transcript-panel')))
        .toBeVisible()
        .whileElement(by.id('recording-controls-scroll'))
        .scroll(120, 'down', 0.5, 0.35);
      assertionStage = 'create transcript';
      await element(by.id('transcript-create')).tap();

      assertionStage = 'read transcript metadata';
      const transcript = element(by.id('transcript-text-0'));
      // Wait for transcript, memory, and question evidence writes before querying the rendered row.
      await waitFor(transcript).toExist().withTimeout(30000);
      await scrollToTranscriptControl(transcript);
      const originalText = accessibilityText(await transcript.getAttributes());
      jestExpect(originalText.length).toBeGreaterThan(0);
      const reviewState = element(by.id('transcript-review-0'));
      await scrollToTranscriptControl(reviewState);
      const originalReviewState = accessibilityText(
        await reviewState.getAttributes(),
      );
      jestExpect(originalReviewState).toBe('검토 전 초안');
      const transcriptScreen = await device.takeScreenshot(
        'transcript-evidence-before-playback',
      );
      console.log('TRANSCRIPT_EVIDENCE_SCREENSHOT ' + transcriptScreen);
      const engineAttributes = await element(
        by.id('transcript-engine-0'),
      ).getAttributes();
      const runtimeAttributes = await element(
        by.id('transcript-runtime-0'),
      ).getAttributes();
      const rangeAttributes = await element(
        by.id('transcript-range-0'),
      ).getAttributes();
      const engine = accessibilityText(engineAttributes);
      const runtime = accessibilityText(runtimeAttributes);
      const rangeLabel = rangeAttributes.label || rangeAttributes.text;
      jestExpect(engine).toBe('엔진: synthetic-fixture-adapter');
      jestExpect(runtime).toBe('시스템 버전: fixture-v1');
      jestExpect(typeof rangeLabel).toBe('string');
      const range = /^(\d{2}):(\d{2})\.(\d{3})–(\d{2}):(\d{2})\.(\d{3})$/.exec(
        rangeLabel,
      );
      jestExpect(range).not.toBeNull();
      const startMs =
        Number(range[1]) * 60_000 + Number(range[2]) * 1000 + Number(range[3]);
      const endMs =
        Number(range[4]) * 60_000 + Number(range[5]) * 1000 + Number(range[6]);

      assertionStage = 'play selected audio range';
      // Scroll the evidence row's bounded list so its action remains hittable on compact Simulator screens.
      const playButton = element(by.id('transcript-play-0'));
      await scrollToTranscriptControl(playButton);
      await playButton.tap();
      const playbackResult = element(
        by.id('transcript-evidence-playback-result'),
      );
      assertionStage = 'wait for playback completion';
      await waitFor(playbackResult).toExist().withTimeout(30000);
      await waitForProbeControl(playbackResult);
      await waitFor(playbackResult).toBeVisible().withTimeout(30000);
      const playbackAttributes = await playbackResult.getAttributes();
      const playback = JSON.parse(
        playbackAttributes.label || playbackAttributes.text,
      );
      jestExpect(playback.startMs).toBe(startMs);
      jestExpect(playback.endMs).toBe(endMs);
      jestExpect(
        Math.abs(playback.actualStartMs - startMs),
      ).toBeLessThanOrEqual(50);

      const correction = '사용자가 확인한 전사 수정';
      assertionStage = 'edit transcript';
      const editButton = element(by.id('transcript-edit-0'));
      await scrollToTranscriptControl(editButton);
      await editButton.tap();
      const transcriptInput = element(by.id('transcript-input-0'));
      await scrollToTranscriptControl(transcriptInput);
      await transcriptInput.replaceText(correction);
      assertionStage = 'save transcript correction';
      const saveButton = await scrollToSaveButton('transcript-save-0');
      console.log(
        'TRANSCRIPT_EVIDENCE_SAVE_SCREENSHOT ' +
          (await device.takeScreenshot('transcript-evidence-save-visible')),
      );
      await saveButton.tap();
      const correctionStatus = element(
        by.id('transcript-evidence-correction-status'),
      );
      assertionStage = 'wait for transcript correction persistence';
      try {
        await waitFor(correctionStatus).toHaveText('saved').withTimeout(15000);
      } catch (failure) {
        const currentStatus = accessibilityText(
          await correctionStatus.getAttributes(),
        );
        throw new Error(
          `Correction service status was ${currentStatus}: ${failureDescription(failure)}`,
        );
      }
      assertionStage = 'verify transcript history and stale artifact';
      const correctedTranscript = element(by.id('transcript-text-0'));
      await waitFor(correctedTranscript).toExist().withTimeout(30000);
      await scrollToTranscriptControl(correctedTranscript);
      const correctedText = accessibilityText(
        await correctedTranscript.getAttributes(),
      );
      jestExpect(correctedText).toBe(correction);
      const history = element(by.id('transcript-history-0-1'));
      await waitFor(history).toExist().withTimeout(30000);
      await scrollToTranscriptControl(history, 'up');
      await waitFor(history).toBeVisible().withTimeout(30000);
      const historyText = accessibilityText(await history.getAttributes());
      jestExpect(historyText).toContain('이전 버전 1:');
      jestExpect(historyText).toContain(originalText);
      await scrollToTranscriptControl(reviewState, 'up');
      const correctedReviewState = accessibilityText(
        await reviewState.getAttributes(),
      );
      jestExpect(correctedReviewState).toBe('수정됨 · 다시 확인 필요');
      const staleArtifacts = await scrollToStaleArtifactNotice();
      await waitFor(staleArtifacts).toBeVisible().withTimeout(30000);
      const staleArtifactText = accessibilityText(
        await staleArtifacts.getAttributes(),
      );
      jestExpect(staleArtifactText).toContain('1개');

      assertionStage = 'verify transcript memory invalidation and restart';
      await element(by.id('transcript-evidence-verify-memory')).tap();
      const memoryStatus = element(by.id('transcript-evidence-memory-status'));
      await waitFor(memoryStatus).toHaveText('passed').withTimeout(30000);

      console.log(
        'TRANSCRIPT_EVIDENCE_SIMULATOR_RESULT ' +
          JSON.stringify({
            transcript: {
              originalText,
              engine,
              runtime,
              range: rangeLabel,
              originalReviewState,
              correctedText,
              historyText,
              correctedReviewState,
              staleArtifactText,
              memoryInvalidation: accessibilityText(
                await memoryStatus.getAttributes(),
              ),
            },
            playback,
            transcriptSource: 'synthetic-fixture-adapter',
          }),
      );
    } catch (failure) {
      assertionFailure = new Error(
        `${assertionStage}: ${failureDescription(failure)}`,
      );
    }

    // Pass the spec's Detox APIs into helpers instead of relying on global bindings.
    const detoxApi = { by, device, element, waitFor };
    assertionFailure ??= await runTranscriptDeletionAssertion(detoxApi);

    let cleanupFailure;
    let cleanupEvidence;
    try {
      cleanupEvidence = await cleanupTranscriptEvidenceIfPresent(detoxApi);
    } catch (failure) {
      cleanupFailure = failure;
    }

    // Keep the original behavior failure visible even when the cleanup control also fails.
    const failures = [];
    if (nativeProbeFailure) {
      const description = failureDescription(nativeProbeFailure);
      console.error('SPEECH_TRANSCRIPTION_SIMULATOR_FAILURE ' + description);
      failures.push(`Native speech probe failed: ${description}`);
    }
    if (assertionFailure) {
      const description = failureDescription(assertionFailure);
      console.error('TRANSCRIPT_EVIDENCE_ASSERTION_FAILURE ' + description);
      failures.push(`Transcript assertion failed: ${description}`);
    }
    if (cleanupFailure) {
      const description = failureDescription(cleanupFailure);
      console.error('TRANSCRIPT_EVIDENCE_CLEANUP_FAILURE ' + description);
      failures.push(`Transcript cleanup failed: ${description}`);
    } else {
      console.log(
        'TRANSCRIPT_EVIDENCE_CLEANUP_RESULT ' + JSON.stringify(cleanupEvidence),
      );
    }
    // Run export after transcript cleanup even on failure so both phases report in one profile case.
    try {
      const exportFailure = await runRecordingExportScenario(detoxApi);
      if (exportFailure) failures.push(exportFailure);
    } catch (failure) {
      const description = failureDescription(failure);
      console.error('RECORDING_EXPORT_PROBE_FAILURE ' + description);
      failures.push(`Recording export probe failed: ${description}`);
    }
    if (failures.length > 0) {
      throw new Error(failures.join('\n'));
    }
  });
});
