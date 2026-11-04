import type { SavedSummarySource } from '../../diseaseHypotheses/savedSummaries';
import type { EvidenceReference } from '@orot/agent-runtime';
import { publicWebSources } from '../../externalMedicalEvidence/publicWebSources';
export type RetainedResearch =
  | {
      kind: 'publication';
      title: string;
      url: string;
      status: 'historical_snapshot';
      publicationDate?: string;
      updatedDate?: string;
      retrievedAt?: string;
    }
  | {
      kind: 'public_web_search';
      sources: readonly { title: string; url: string }[];
      status: 'historical_snapshot';
      retrievedAt?: string;
    };

function retainedTime(value: unknown, dateOnly = false): string | undefined {
  if (
    typeof value !== 'string' ||
    !(
      dateOnly
        ? /^\d{4}-\d{2}-\d{2}$/u
        : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u
    ).test(value)
  )
    return undefined;
  const time = Date.parse(value);
  if (
    !Number.isFinite(time) ||
    new Date(time).toISOString().slice(0, dateOnly ? 10 : 19) !==
      value.slice(0, dateOnly ? 10 : 19)
  )
    return undefined;
  return value;
}

/** Expose only validated public links; retained references do not establish current publication status. */
export function retainedResearchMetadata(
  references: readonly EvidenceReference[],
): RetainedResearch[] {
  return references.flatMap((reference): RetainedResearch[] => {
    if (reference.sourceKind !== 'external_medical') return [];
    const locator = reference.locator;
    if (!locator || typeof locator !== 'object' || Array.isArray(locator))
      return [];
    const fields = locator as Readonly<Record<string, unknown>>;
    const retrievedAt = retainedTime(fields.retrievedAt);
    const web = publicWebSources(reference);
    if (web)
      return [
        {
          kind: 'public_web_search',
          sources: web,
          status: 'historical_snapshot',
          ...(retrievedAt ? { retrievedAt } : {}),
        },
      ];
    if (
      fields.provider !== 'Europe PMC' ||
      typeof fields.title !== 'string' ||
      !fields.title.trim() ||
      typeof fields.source !== 'string' ||
      typeof fields.recordId !== 'string' ||
      !/^[A-Za-z0-9._-]{1,80}$/u.test(fields.source) ||
      !/^[A-Za-z0-9._-]{1,80}$/u.test(fields.recordId) ||
      fields.originalUrl !==
        `https://europepmc.org/article/${fields.source}/${fields.recordId}`
    )
      return [];
    const publicationDate = retainedTime(fields.publicationDate, true);
    const updatedDate = retainedTime(fields.updatedDate, true);
    return [
      {
        kind: 'publication',
        title: fields.title.slice(0, 500),
        url: fields.originalUrl,
        status: 'historical_snapshot',
        ...(publicationDate ? { publicationDate } : {}),
        ...(updatedDate ? { updatedDate } : {}),
        ...(retrievedAt ? { retrievedAt } : {}),
      },
    ];
  });
}

/** Search only the public titles already retained in an artifact's external references. */
export function retainedResearchSearchText(
  sources: readonly SavedSummarySource[],
): string {
  return retainedResearchMetadata(sources.map(source => source.reference))
    .flatMap(item =>
      item.kind === 'publication'
        ? [item.title]
        : item.sources.map(source => source.title),
    )
    .join(' ')
    .normalize('NFKC')
    .toLowerCase();
}
