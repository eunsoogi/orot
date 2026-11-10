import type { EvidenceItem } from '@orot/agent-runtime';
import { renderLocalClaims } from './localEvidenceClaims';
import { renderLiteratureAnswer } from './literatureStatistics';

/** Compose only independently validated source material; a comparison needs its own evidence. */
export function renderMixedEvidenceAnswer(
  value: Record<string, unknown>,
  items: readonly EvidenceItem[],
) {
  const local =
    'localClaims' in value
      ? renderLocalClaims(value.localClaims, items)
      : undefined;
  const literature =
    'literature' in value
      ? renderLiteratureAnswer(value.literature, items)
      : undefined;
  if (
    ('localClaims' in value && !local) ||
    ('literature' in value && !literature) ||
    (!local && !literature)
  )
    return undefined;
  return {
    answer: [
      local?.answer,
      literature?.answer,
      local && literature
        ? '기록과 문헌의 직접적인 비교는 확인하지 못했어요.'
        : undefined,
    ]
      .filter(Boolean)
      .join('\n\n'),
    localReferences: local?.references ?? [],
    literatureReferences: literature?.references ?? [],
    // Source-bound excerpts do not yet establish the meaning of each selected sentence.
    partial: Boolean(literature),
  };
}
