// Keep this pure helper suite in the unit-test tree; Detox replaces Jest's async matchers.
const {
  verifyFinalNativeSpeechProbe,
  verifyNativeSpeechProbe,
} = require('../../../e2e/transcription/transcriptEvidenceDetoxHelpers');

const syntheticFixture = { synthetic: true };

function reportElement(report) {
  return { getAttributes: async () => ({ label: JSON.stringify(report) }) };
}

function baseReport(outcome, extra = {}) {
  return {
    outcome,
    providerId: 'apple-on-device-speech',
    fixture: syntheticFixture,
    cases: [],
    ...extra,
  };
}

describe('native speech probe report validation', () => {
  let originalWaitFor;

  beforeEach(() => {
    originalWaitFor = global.waitFor;
    global.waitFor = () => ({
      toBeVisible: () => ({ withTimeout: async () => undefined }),
    });
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    global.waitFor = originalWaitFor;
    jest.restoreAllMocks();
  });

  it('accepts a supported native report with three measured cases', async () => {
    const report = baseReport('measured', {
      cases: Array.from({ length: 3 }, (_, index) => ({
        id: `case-${index}`,
        recognizedText: '측정된 음성',
        accuracy: { characterErrorRate: 0 },
        segments: [{ startSeconds: 0, endSeconds: 1 }],
      })),
    });

    await expect(
      verifyNativeSpeechProbe(reportElement(report)),
    ).resolves.toEqual(report);
  });

  it('accepts only an explicit unsupported availability state', async () => {
    const report = baseReport('explicitly_unsupported', {
      initialAvailability: { status: 'model_unavailable' },
      reason: {
        code: 'model_unavailable',
        message: 'The native API reported the model unavailable.',
      },
    });

    await expect(
      verifyNativeSpeechProbe(reportElement(report)),
    ).resolves.toEqual(report);
  });

  it.each(['INVALID_AVAILABILITY_STATUS', 'TRANSCRIPTION_PROBE_FAILED'])(
    'rejects unexpected native failure %s',
    async code => {
      const report = baseReport('failed', {
        reason: { code, message: 'Unexpected native failure.' },
      });

      await expect(
        verifyNativeSpeechProbe(reportElement(report)),
      ).rejects.toThrow(`The native speech probe failed: {"code":"${code}"`);
    },
  );

  it('reports a still-running probe without claiming a measurement', async () => {
    const report = baseReport('running');

    await expect(
      verifyNativeSpeechProbe(reportElement(report)),
    ).resolves.toEqual(report);
  });

  it('rejects a failure that appears after the initial running report', async () => {
    const reports = [
      baseReport('running'),
      baseReport('failed', {
        reason: {
          code: 'TRANSCRIPTION_PROBE_FAILED',
          message: 'The native probe failed after it started.',
        },
      }),
    ];
    let readCount = 0;
    const transitioningElement = {
      getAttributes: async () => ({
        label: JSON.stringify(
          reports[Math.min(readCount++, reports.length - 1)],
        ),
      }),
    };

    await expect(
      verifyNativeSpeechProbe(transitioningElement),
    ).resolves.toMatchObject({ outcome: 'running' });
    await expect(
      verifyFinalNativeSpeechProbe(transitioningElement),
    ).rejects.toThrow('The native speech probe failed');
  });

  it('waits for the final report to contain all measured native cases', async () => {
    const measured = baseReport('measured', {
      cases: Array.from({ length: 3 }, (_, index) => ({
        id: `case-${index}`,
        recognizedText: '측정된 음성',
        accuracy: { characterErrorRate: 0 },
        segments: [{ startSeconds: 0, endSeconds: 1 }],
      })),
    });
    const reports = [baseReport('running'), measured];
    let readCount = 0;
    const transitioningElement = {
      getAttributes: async () => ({
        label: JSON.stringify(
          reports[Math.min(readCount++, reports.length - 1)],
        ),
      }),
    };

    await expect(
      verifyFinalNativeSpeechProbe(transitioningElement, {
        timeoutMs: 100,
        pollIntervalMs: 0,
      }),
    ).resolves.toEqual(measured);
    expect(readCount).toBe(2);
  });

  it('waits for and preserves a terminal explicit unsupported result', async () => {
    const unsupported = baseReport('explicitly_unsupported', {
      reason: {
        code: 'model_unavailable',
        message: 'The native API reported the model unavailable.',
      },
    });
    const reports = [baseReport('running'), unsupported];
    let readCount = 0;
    const transitioningElement = {
      getAttributes: async () => ({
        label: JSON.stringify(
          reports[Math.min(readCount++, reports.length - 1)],
        ),
      }),
    };

    await expect(
      verifyFinalNativeSpeechProbe(transitioningElement, {
        timeoutMs: 100,
        pollIntervalMs: 0,
      }),
    ).resolves.toEqual(unsupported);
  });

  it('fails when the final native report remains running until its deadline', async () => {
    const element = reportElement(baseReport('running'));

    await expect(
      verifyFinalNativeSpeechProbe(element, {
        timeoutMs: 30,
        pollIntervalMs: 5,
      }),
    ).rejects.toThrow('did not reach a terminal outcome within 30ms');
  });

  it('bounds a final report read that never resolves', async () => {
    const element = { getAttributes: () => new Promise(() => {}) };

    await expect(
      verifyFinalNativeSpeechProbe(element, {
        timeoutMs: 30,
        pollIntervalMs: 5,
      }),
    ).rejects.toThrow('did not reach a terminal outcome within 30ms');
  });
});
