import type { ReactNode } from 'react';
import type { DiseaseHypothesisAnalysis } from '../diseaseHypotheses/types';
import { ConversationReportSection } from './ConversationReportSection';
import { HealthSummaryText } from './HealthSummaryText';

type Section = DiseaseHypothesisAnalysis['hypotheses'][number];

/** Use the same summary hierarchy for live and saved results. The caller, not
 * this display surface, owns any source links or other section controls. */
export function HealthSummarySections({
  sections,
  renderSectionTail,
}: {
  readonly sections: readonly Section[];
  readonly renderSectionTail?: (section: Section, index: number) => ReactNode;
}) {
  return sections.map((section, index) => (
    <ConversationReportSection key={index} title={section.title}>
      <HealthSummaryText text={section.summary} />
      {section.uncertainty ? (
        <HealthSummaryText text={section.uncertainty} />
      ) : null}
      {section.missingData.map((missing, number) => (
        <HealthSummaryText key={number} text={missing} />
      ))}
      {renderSectionTail?.(section, index)}
    </ConversationReportSection>
  ));
}
