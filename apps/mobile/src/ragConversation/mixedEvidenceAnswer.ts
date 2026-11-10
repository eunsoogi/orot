import type { EvidenceItem } from '@orot/agent-runtime';
import { renderLocalClaims } from './localEvidenceClaims';
import { renderLiteratureAnswer } from './literatureStatistics';
import { requestsLiteratureExplanation } from './literatureIntent';

/** Compose only independently validated source material; a comparison needs its own evidence. */
export function renderMixedEvidenceAnswer(
  value: Record<string, unknown>,
  items: readonly EvidenceItem[],
  request: string,
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
  // A record-only result cannot satisfy a request that also asks for literature.
  const missingLiterature = Boolean(
    local && !literature && requestsLiteratureExplanation(request),
  );
  return {
    answer: [
      local?.answer,
      literature?.answer,
      local && literature
        ? '기록과 문헌의 직접적인 비교는 확인하지 못했어요.'
        : undefined,
      missingLiterature
        ? '요청하신 문헌은 확인하지 못했고 기록과의 비교도 확인하지 못했어요.'
        : undefined,
    ]
      .filter(Boolean)
      .join('\n\n'),
    localReferences: local?.references ?? [],
    literatureReferences: literature?.references ?? [],
    // Source-bound excerpts do not yet establish the meaning of each selected sentence.
    partial: Boolean(literature) || missingLiterature,
  };
}
