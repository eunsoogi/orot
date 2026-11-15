import { t } from '../../i18n';
import type { ResearchArtifact } from '../../storage/researchArtifactStorage';
import type { EvidenceSourceDetailSection } from './evidenceSourcePresentation';

/** Present public citation metadata and generated web text with their distinct limits. */
export function presentResearchSource(
  research: ResearchArtifact,
): readonly EvidenceSourceDetailSection[] {
  return [
    {
      title: t('sourceDisplay.researchTitle'),
      rows: [
        { label: t('sourceDisplay.retrievedAt'), value: research.createdAt },
        {
          label: t('sourceDisplay.sourceStatus'),
          value: t('sourceDisplay.unverifiedCurrentStatus'),
        },
        {
          label: t('sourceDisplay.caution'),
          value:
            research.source.kind === 'publication'
              ? t('sourceDisplay.metadataOnly')
              : t('sourceDisplay.generatedNotFact'),
        },
      ],
      hero: {
        heading:
          research.source.kind === 'publication'
            ? research.source.title
            : t('sourceDisplay.webExplanation'),
        body: research.generatedText ?? '',
        consumedLabels: [],
      },
    },
  ];
}
