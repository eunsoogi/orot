/** Keep execution outcomes from changing which planned cases belong in timing totals. */
export function selectedSummaryCases(summary, fallbackCohorts) {
  const cohortNames = new Set(
    summary?.selection?.valid === false
      ? []
      : (summary?.selection?.selectedCohorts ?? fallbackCohorts),
  );
  return (
    summary?.cases?.filter((item) => {
      if (item.status === 'not-selected') return false;
      if (item.category === 'authentication')
        return summary.coverage?.authentication?.selected === true;
      return cohortNames.has(item.cohort);
    }) ?? []
  );
}
