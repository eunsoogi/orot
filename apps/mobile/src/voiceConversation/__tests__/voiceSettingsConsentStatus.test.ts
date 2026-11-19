import { voiceStatus } from '../voiceStatus';
import { initialVoiceState } from '../voiceTurn';

test('missing model permission points to settings rather than another chat transmission prompt', () => {
  expect(
    voiceStatus(false, false, false, {
      ...initialVoiceState,
      phase: 'error',
      error: 'consent',
    }),
  ).toContain('모델 설정');
  expect(
    voiceStatus(false, false, false, {
      ...initialVoiceState,
      phase: 'error',
      error: 'permission',
    }),
  ).not.toContain('전송 범위');
});
