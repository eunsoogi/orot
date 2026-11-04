import type { TaskResponderContract } from '@orot/agent-runtime';
import type { DiseaseHypothesisAnalysis } from '../../diseaseHypotheses/types';

/** A web-search explanation is a model-generated secondary source, not a paper. */
export function publicSummaryTask(
  base: TaskResponderContract<DiseaseHypothesisAnalysis>,
): TaskResponderContract<DiseaseHypothesisAnalysis> {
  return {
    ...base,
    systemPrompt:
      base.systemPrompt
        .replace(
          'After searching personal records, use the public medical literature tool for related general concepts.',
          'Use the supplied relevant public sources for general medical context.',
        )
        .replace(
          'Cite only retrieved publications for medical context.',
          'Cite the supplied public source for medical context.',
        ) +
      ' A public-web-search item is a model-generated explanation based on linked web pages, not an original publication. Describe it as an AI-generated public-web explanation. Europe PMC items are publication records; do not call web explanations papers or imply a web retrieval date is a publication date.',
    createMessages(input) {
      return [
        ...base.createMessages(input),
        {
          role: 'system',
          content:
            'Treat public-web-search evidence as an AI-generated explanation with linked sources, never as an original paper. Europe PMC evidence represents publications. If the public source is not relevant, state that limitation without inventing facts.',
        },
      ];
    },
  };
}
