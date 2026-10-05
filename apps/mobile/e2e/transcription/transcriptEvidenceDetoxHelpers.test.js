const { verifyNativeSpeechProbe } = require('./transcriptEvidenceDetoxHelpers');

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
});
