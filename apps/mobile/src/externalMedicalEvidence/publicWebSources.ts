import type { EvidenceReference } from '@orot/agent-runtime';

export const PUBLIC_WEB_SOURCE_ID = 'public-web';
export interface PublicWebSource {
  readonly title: string;
  readonly url: string;
}

/** Web citations are provider-returned links on a generated explanation, not paper identifiers. */
export function isPublicWebReference(reference: EvidenceReference): boolean {
  return (
    reference.sourceKind === 'external_medical' &&
    reference.sourceId === PUBLIC_WEB_SOURCE_ID
  );
}

/** Validate persisted references again before handing a URL to the operating system. */
export function publicWebSources(
  reference: EvidenceReference,
): readonly PublicWebSource[] | undefined {
  if (!isPublicWebReference(reference)) return undefined;
  const locator = reference.locator;
  if (!locator || typeof locator !== 'object' || Array.isArray(locator))
    return undefined;
  const value = locator as Record<string, unknown>;
  if (
    value.kind !== 'public_web_search' ||
    !Array.isArray(value.sources) ||
    !value.sources.length ||
    value.sources.length > 8
  )
    return undefined;
  const sources: PublicWebSource[] = [];
  for (const entry of value.sources) {
    if (!entry || typeof entry !== 'object') return undefined;
    const source = entry as Record<string, unknown>;
    if (
      typeof source.title !== 'string' ||
      !source.title.trim() ||
      source.title.length > 256 ||
      typeof source.url !== 'string' ||
      source.url.length > 2048
    )
      return undefined;
    try {
      const url = new URL(source.url);
      if (
        !['https:', 'http:'].includes(url.protocol) ||
        !url.hostname ||
        url.username ||
        url.password
      )
        return undefined;
    } catch {
      return undefined;
    }
    sources.push({ title: source.title, url: source.url });
  }
  return sources;
}
