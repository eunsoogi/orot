import {
  defaultLanguage,
  formatDate,
  formatDateTime,
  formatNumber,
  formatTime,
  resolveLanguage,
  supportedLanguages,
  t,
} from '../src/i18n';

describe('Korean-only localization', () => {
  it('uses Korean for the default language and unsupported device locales', () => {
    expect(defaultLanguage).toBe('ko');
    expect(supportedLanguages).toEqual(['ko']);
    expect(resolveLanguage()).toBe('ko');
    expect(resolveLanguage('en-US')).toBe('ko');
    expect(resolveLanguage('fr_FR')).toBe('ko');
    expect(resolveLanguage('ko-KR')).toBe('ko');
  });

  it('keeps interpolation values intact', () => {
    expect(
      t('appointments.actions.cancelForClinic', { clinic: 'Clinic {name}' }),
    ).toBe('Clinic {name} 예약 취소');
  });

  it('formats dates, times, and numbers with Korean conventions', () => {
    const value = new Date('2027-06-02T00:45:00.000Z');

    expect(
      formatDate(value, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC',
      }),
    ).toBe('2027년 6월 2일');
    expect(formatTime(value, 'Asia/Seoul')).toBe('09:45');
    expect(formatDateTime(value, 'Asia/Seoul')).toBe('2027년 6월 2일 09:45');
    expect(formatNumber(1234567)).toBe('1,234,567');
  });
});
