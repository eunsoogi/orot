import { resolveLanguage, supportedLanguages, t } from '..';
import { createPublicWebEvidence } from '../../aiFeatures/integration/publicWebEvidence';
import { publicEvidenceFixture } from '../../aiFeatures/integration/testSupport/publicWebEvidenceTestSupport';

// Both labels are serialized into disclosure/source records, not merely rendered decoration.
test.each(['ko-KR', 'en-US', 'ja-JP', 'fr-FR'])(
  'keeps exact public-search consent and locator labels for %s',
  async deviceLocale => {
    const options = new Intl.DateTimeFormat().resolvedOptions();
    const locale = jest
      .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
      .mockReturnValue({ ...options, locale: deviceLocale });
    try {
      expect(supportedLanguages).toEqual(['ko']);
      expect(resolveLanguage()).toBe('ko');
      const run = publicEvidenceFixture();
      const recipient = 'Synthetic {account} · unchanged';
      const web = createPublicWebEvidence({
        ...run,
        selected: { ...run.selected, recipient },
      })!;
      const result = await web.tool.search(run.request);
      expect(run.authorize).toHaveBeenCalledWith(
        expect.objectContaining({
          recipient: 'Synthetic {account} · unchanged · 공개 웹검색',
          providerId: run.selected.provider.id,
          modelId: 'gpt-6-luna',
        }),
      );
      if ('status' in result)
        throw new Error('Expected synthetic public batch');
      expect(result.items[0]?.locator).toMatchObject({ title: '공개 웹검색' });
      expect(t('externalMedicalEvidence.publicSearchSourceTitle')).toBe(
        '공개 웹검색',
      );
      expect(run.search).toHaveBeenCalledTimes(1);
    } finally {
      locale.mockRestore();
    }
  },
);
