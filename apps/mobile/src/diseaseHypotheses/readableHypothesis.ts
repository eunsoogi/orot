import type { DiseaseHypothesis } from './types';

/** Formats prose only; exact citation objects still drive validation, storage and source actions. */
export function readableHypothesis(item: DiseaseHypothesis): DiseaseHypothesis {
  const ids = new Set(
    [...item.supportingEvidence, ...item.contraryEvidence].flatMap(ref => [
      ref.evidenceId,
      ref.sourceId,
    ]),
  );
  const prose = (text: string) =>
    text
      .replace(/[ \t]*\[([^\]\r\n]+)\]/gu, (match, body: string) => {
        const tokens = body.trim().split(/\s*[,;]\s*/u);
        // eN is the registry's reserved transient namespace. Old saved prose can
        // retain these aliases even after its source references receive new ones.
        // Remove only whole citation groups, preserving clinical brackets and values.
        return tokens.every(
          token => /^e[1-9]\d*$/u.test(token) || ids.has(token),
        )
          ? ''
          : match;
      })
      .trim();
  return {
    ...item,
    title: prose(item.title),
    summary: prose(item.summary),
    uncertainty: prose(item.uncertainty),
    missingData: item.missingData.map(prose),
  };
}
