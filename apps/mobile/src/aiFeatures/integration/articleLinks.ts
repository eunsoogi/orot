import { Linking } from 'react-native';
import type { ExternalMedicalPublication } from '../../externalMedicalEvidence/europePmc';

/** Accepts only the canonical Europe PMC article URL produced from its validated identifiers. */
export function isSafeEuropePmcArticleUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname === 'europepmc.org' &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash &&
      /^\/article\/[A-Za-z0-9._-]{1,80}\/[A-Za-z0-9._-]{1,80}$/u.test(
        url.pathname,
      )
    );
  } catch {
    return false;
  }
}

/** Opens the exact result record, and lets the caller show failure instead of silently dropping it. */
export async function openEuropePmcArticle(
  publication: ExternalMedicalPublication,
  openUrl: (url: string) => Promise<unknown> = url => Linking.openURL(url),
): Promise<void> {
  const expectedUrl = `https://europepmc.org/article/${publication.source}/${publication.recordId}`;
  if (
    !isSafeEuropePmcArticleUrl(publication.originalUrl) ||
    publication.originalUrl !== expectedUrl
  ) {
    throw new Error(
      'The publication link is not a canonical Europe PMC article.',
    );
  }
  await openUrl(publication.originalUrl);
}
