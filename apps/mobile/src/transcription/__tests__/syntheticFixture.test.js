const { createHash } = require('node:crypto');
const { Buffer } = require('node:buffer');
const fixture = require('../../../e2e/transcription/fixtures/synthetic-korean.json');

describe('synthetic Korean transcription fixture', () => {
  it.each(fixture.cases)(
    '$id preserves its expected text and audio bytes',
    speechCase => {
      // Bind reported accuracy to the exact generated audio bytes, not to fixture prose or a mocked transcript.
      const audio = Buffer.from(speechCase.audio.base64, 'base64');
      expect(audio.toString('base64')).toBe(speechCase.audio.base64);
      expect(createHash('sha256').update(audio).digest('hex')).toBe(
        speechCase.audio.sha256,
      );
      expect(speechCase.expectedText).toEqual(expect.any(String));
      expect(speechCase.audio.durationSeconds).toBeGreaterThan(0);
    },
  );
});
