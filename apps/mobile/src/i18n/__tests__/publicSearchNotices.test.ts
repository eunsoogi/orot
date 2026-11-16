import { resolveLanguage, supportedLanguages, t } from '..';
import { publicSearchNotice } from '../../aiFeatures/integration/defaultPublicSearch';

// Persisted limitation prose must stay verbatim, including inability versus deliberate exclusion.
test.each([
  [
    'empty',
    'externalMedicalEvidence.publicSearchEmptyNotice',
    '공개 웹검색에서 결과를 찾지 못했어요.',
  ],
  [
    'consent_required',
    'externalMedicalEvidence.publicSearchConsentNotice',
    '공개 웹검색 동의가 없어 검색 결과를 반영하지 못했어요.',
  ],
  [
    'unavailable',
    'externalMedicalEvidence.publicSearchUnavailableNotice',
    '공개 웹검색을 사용할 수 없어 검색 결과를 반영하지 못했어요.',
  ],
] as const)(
  'keeps %s limitation copy unchanged in the shared catalog',
  (status, key, expected) => {
    expect(t(key)).toBe(expected);
    expect(publicSearchNotice(status)).toBe(expected);
  },
);

test('unsupported device locales retain Korean notices without introducing a language', () => {
  const options = new Intl.DateTimeFormat().resolvedOptions();
  const locale = jest
    .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
    .mockReturnValue({ ...options, locale: 'en-US' });
  try {
    expect(supportedLanguages).toEqual(['ko']);
    expect(resolveLanguage()).toBe('ko');
    expect(publicSearchNotice('consent_required')).toBe(
      '공개 웹검색 동의가 없어 검색 결과를 반영하지 못했어요.',
    );
  } finally {
    locale.mockRestore();
  }
});
