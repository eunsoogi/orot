import type { DiseaseHypothesisAnalysis } from './types';

// Prompt wording is advisory, so reject common certainty claims before displaying model text.
const definitiveClaimPatterns = [
  /\b(?:confirmed|definitive(?:ly)?|definitely|certainly|unquestionably)\b/iu,
  /\b(?:you|the patient)\s+(?:(?:definitely|certainly)\s+)?(?:have|has)\b/iu,
  /\bdiagnosed with\b/iu,
  /\b(?:there is|there's)\s+no (?:clinical )?uncertainty\b/iu,
  /(?:확진|확실히|분명히|명백히|틀림없이|진단(?:받았|받으셨|되었|된|이다|입니다|이에요|이야))/u,
  /(?:불확실(?:성|한 점)(?:이)?|모호함)(?:은|는|이)?\s*(?:없|전혀 없)/u,
];

// Remove only the diagnostic token in an explicit limitation or requested workup.
// Keep every surrounding clause: a disclaimer must not hide a second assertion.
function withoutUncertaintyDisclaimers(text: string): string {
  return text
    .replace(/현재 자료만으로는 확진할 수 없어요\.?/gu, ' ')
    .replace(
      /확진(?=\s*할\s*수(?:는|도)?\s*없(?:어요|습니다|다|음)(?:[.!?\n]|$))/gu,
      ' ',
    )
    .replace(
      /확진(?=\s*여부(?:는|를)\s*(?:추가\s*)?(?:검사|진료)(?:에서|로)\s*확인해야\s*(?:해요|합니다)(?:[.!?\n]|$))/gu,
      ' ',
    )
    .replace(
      /확진(?=을\s*위해\s*(?:추가\s*)?(?:검사|진료)(?:와\s*(?:검사|진료))?가\s*필요(?:해요|합니다)(?:[.!?\n]|$))/gu,
      ' ',
    )
    .replace(
      /\b((?:cannot|can't|could not|couldn't|not)\s+(?:yet\s+)?(?:be\s+)?)confirmed(?=(?:\s+(?:from|by|using)\s+(?:(?:the|these)\s+)?(?:(?:current|available)\s+)?records)?(?:[.!?\n]|$))/giu,
      '$1',
    )
    .replace(
      /\bno definitive diagnosis can be made from these records\.?/giu,
      ' ',
    );
}

/** Applies the final summary's diagnosis guard before any partial text reaches the screen. */
export function canPreviewDiseaseHypothesisSummary(text: string): boolean {
  if (!text.trim() || text.length > 1200) return false;
  const candidate = withoutUncertaintyDisclaimers(text);
  return !definitiveClaimPatterns.some(pattern => pattern.test(candidate));
}

export function containsDefinitiveClinicalClaim(
  hypothesis: DiseaseHypothesisAnalysis['hypotheses'][number],
): boolean {
  return [
    hypothesis.title,
    hypothesis.summary,
    hypothesis.uncertainty,
    ...hypothesis.missingData,
  ].some(text =>
    definitiveClaimPatterns.some(pattern =>
      pattern.test(withoutUncertaintyDisclaimers(text)),
    ),
  );
}
