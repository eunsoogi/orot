import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { resolveLanguage, supportedLanguages, t } from '..';
import { modelSettingsKo } from '../modelSettings';

// Only Korean is currently shipped. Other device languages must retain the same
// safety copy rather than silently losing consent, billing or fallback warnings.
test.each(['ko-KR', 'ko_KR', 'en-US', 'ja-JP', 'fr-FR'])(
  'model settings preserve the shipped catalog for device locale %s',
  locale => {
    expect(supportedLanguages).toEqual(['ko']);
    expect(resolveLanguage(locale)).toBe('ko');
    expect(t('modelSettings.voiceConsent')).toBe(
      modelSettingsKo['modelSettings.voiceConsent'],
    );
    expect(t('modelSettings.voiceConsent')).toContain('별도로 동의');
    expect(t('modelSettings.listPrivacy')).toContain(
      '통화를 시작하지 않습니다.',
    );
    expect(t('modelSettings.apiPrivacy')).toContain('API 사용 요금');
  },
);

test('saved model warning interpolates the exact model ID without changing the selection', () => {
  expect(
    t('modelSettings.savedModelUnavailable', { model: 'synthetic-model' }),
  ).toBe(
    '저장된 모델 synthetic-model의 현재 사용 가능 여부를 확인하지 못했습니다. 선택은 유지되며 다른 모델로 자동 전환하지 않습니다.',
  );
});

test('audited model settings production files have no inline Korean copy', () => {
  for (const directory of ['providers/selection', 'voiceSettings']) {
    const absolute = path.join(__dirname, '../..', directory);
    for (const file of readdirSync(absolute)) {
      if (!/\.tsx?$/u.test(file) || /\.test\./u.test(file)) continue;
      const source = readFileSync(path.join(absolute, file), 'utf8');
      expect({ file, hasInlineKorean: /[가-힣]/u.test(source) }).toEqual({
        file,
        hasInlineKorean: false,
      });
    }
  }
});
