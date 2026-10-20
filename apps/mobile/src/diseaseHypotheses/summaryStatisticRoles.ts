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
      for (const claim of normalized.matchAll(pattern)) {
        const tail = normalized.slice(claim.index! + claim[0].length);
        // A correction inherits the same statistic role: verify the positive
        // replacement, not the explicitly rejected number before "아니라".
        const correction =
          /^\s*(?:이|가)?\s*아니라\s*(\d+(?:\.\d+)?)\s*(?:개|건)/u.exec(tail);
        if (
          !correction &&
          /^\s*(?:이|가)?\s*(?:아니에요|아닙니다|아니다|아님)(?:\s|[.!?。]|$)/u.test(
            tail,
          )
        )
          continue;
        if (!counts.includes(Number(correction?.[1] ?? claim[1])))
          return 'statistic_roles' as const;
      }
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
      const absence =
        /완전한(?:하룻밤|밤)(?:의)?수면(?:기록|자료|데이터)?(?:은|는|이|가)?(?:기록되지(?:않(?:았)?|못(?:했)?)|(?:기록이|자료가)?없(?:었)?)/u.exec(
          compact,
        );
      if (!absence) continue;
      // Bind epistemic negation to this exact predicate. "수밖에 없다" affirms
      // the inference, while "볼 수는 없다" denies that it is established.
      const tail = compact.slice(absence.index + absence[0].length);
      if (
        /^(?:다고(?:볼|말할|단정할|판단할)수(?:는)?없|다는(?:뜻|의미)(?:은|는|이|가)?아니)/u.test(
          tail,
        )
      )
        continue;
      return 'sleep_coverage' as const;
    }
  }
  return undefined;
}
