/** Classify only already-rejected facts. These comparisons never authorize a rounded or converted claim. */
export function rejectedQuantityTransformation(
  amount: number,
  unit: string,
  supported: ReadonlySet<string>,
): 'quantity_precision' | 'quantity_unit' | undefined {
  if (!Number.isFinite(amount) || !unit) return undefined;
  const roundedMatch = (value: number) =>
    [1, 10, 100].some(scale => Math.round(value * scale) / scale === amount);
  for (const fact of supported) {
    const [expression, sourceUnit] = fact.split('\u0000');
    const source = Number(expression);
    if (!Number.isFinite(source)) continue;
    if (unit === sourceUnit && roundedMatch(source))
      return 'quantity_precision';
    // Sleep context is published in minutes. Diagnose common hour rewrites
    // without exposing either number or treating converted prose as source text.
    const converted =
      sourceUnit === '분' && unit === '시간'
        ? source / 60
        : sourceUnit === '시간' && unit === '분'
          ? source * 60
          : undefined;
    if (
      converted !== undefined &&
      (converted === amount || roundedMatch(converted))
    )
      return 'quantity_unit';
  }
  return undefined;
}
