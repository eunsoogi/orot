type Fact = Record<string, unknown>;

/** Check explicit statistic-role predicates only for app-authored aggregates.
 * This complements citation/value anchors; it is not a general prose or clinical fact verifier.
 * A measurement amount cannot become an observation count simply because both are numbers. */
export function summaryStatisticRoleIssue(
  text: string,
  facts: readonly Fact[],
) {
  const quantities = facts.filter(
    fact => fact.kind === 'health_context_quantity',
  );
  const counts = quantities.flatMap(fact =>
    typeof fact.sampleCount === 'number' && Number.isFinite(fact.sampleCount)
      ? [fact.sampleCount]
      : [],
  );
  const normalized = text.normalize('NFKC').replace(/(?<=\d),(?=\d)/gu, '');
  if (counts.length) {
    const patterns = [
      /(?<![\d.])(\d+(?:\.\d+)?)\s*(?:개(?:의)?)?\s*(?:샘플|표본|samples?\b)/gu,
      /(?:샘플|표본)(?:\s*(?:개수|수))?\s*(?:는|은|이|가)?\s*(?:총|합계|:|=)?\s*(\d+(?:\.\d+)?)\s*(?:개|건)/gu,
    ];
    for (const pattern of patterns)
      for (const claim of normalized.matchAll(pattern))
        if (!counts.includes(Number(claim[1])))
          return 'statistic_roles' as const;
  }
  if (
    facts.some(
      fact =>
        fact.kind === 'health_context_sleep' &&
        fact.aggregationScope === 'calendar_day_union_not_complete_night',
    )
  ) {
    for (const clause of normalized.split(/[.!?。\n]/u)) {
      const compact = clause.replace(/\s/gu, '');
      // An explicit denial of an absence inference is a valid limitation, not an absence claim.
      if (/(?:없|않)(?:다는|다고).{0,16}(?:아니|없)/u.test(compact)) continue;
      if (
        /완전한(?:하룻밤|밤)(?:의)?수면(?:기록|자료|데이터)?(?:은|는|이|가)?(?:기록되지(?:않|못)|기록이없|자료가없|없(?:음|어요|습니다|다|$))/u.test(
          compact,
        )
      )
        return 'sleep_coverage' as const;
    }
  }
  return undefined;
}
