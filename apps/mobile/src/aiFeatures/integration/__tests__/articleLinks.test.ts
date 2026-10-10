import {
  isSafeEuropePmcArticleUrl,
  openEuropePmcArticle,
} from '../articleLinks';
import type { ExternalMedicalPublication } from '../../../externalMedicalEvidence/europePmc';

const publication: ExternalMedicalPublication = {
  provider: 'Europe PMC',
  recordId: '12345',
  source: 'MED',
  title: 'A sourced article',
  authors: null,
  journal: null,
  publicationDate: null,
  updatedDate: null,
  abstract: null,
  originalUrl: 'https://europepmc.org/article/MED/12345',
  retrievedAt: '2026-10-08T00:00:00.000Z',
};

describe('Europe PMC article links', () => {
  it('allows only the canonical HTTPS article path', () => {
    expect(
      isSafeEuropePmcArticleUrl('https://europepmc.org/article/MED/12345'),
    ).toBe(true);
    expect(
      isSafeEuropePmcArticleUrl('http://europepmc.org/article/MED/12345'),
    ).toBe(false);
    expect(
      isSafeEuropePmcArticleUrl(
        'https://europepmc.org.attacker.test/article/MED/12345',
      ),
    ).toBe(false);
    expect(
      isSafeEuropePmcArticleUrl(
        'https://europepmc.org@attacker.test/article/MED/12345',
      ),
    ).toBe(false);
    expect(
      isSafeEuropePmcArticleUrl(
        'https://europepmc.org/article/MED/12345?next=https://attacker.test',
      ),
    ).toBe(false);
    expect(isSafeEuropePmcArticleUrl('javascript:alert(1)')).toBe(false);
  });

  it('opens the exact article that matches the displayed record identity', async () => {
    const openUrl = jest.fn(async () => undefined);
    await openEuropePmcArticle(publication, openUrl);
    expect(openUrl).toHaveBeenCalledWith(publication.originalUrl);

    await expect(
      openEuropePmcArticle(
        { ...publication, recordId: 'different-record' },
        openUrl,
      ),
    ).rejects.toThrow('canonical Europe PMC article');
    expect(openUrl).toHaveBeenCalledTimes(1);
  });
});
