import {
  appleAvailabilityMessage,
  appleGenerationFailureMessage,
} from '../availabilityMessage';

describe('Apple provider localization', () => {
  it('provides Korean text for every native availability state', () => {
    expect(appleAvailabilityMessage('available')).toContain('Apple Intelligence');
    expect(appleAvailabilityMessage('disabled')).toContain('설정');
    expect(appleAvailabilityMessage('modelNotReady')).toContain('준비');
    expect(appleAvailabilityMessage('unsupportedDevice')).toContain('기기');
    expect(appleAvailabilityMessage('unsupportedLanguage')).toContain('한국어');
    expect(appleGenerationFailureMessage()).toContain('질문');
  });
});
