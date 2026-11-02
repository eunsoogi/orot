import { navigationBottomPlan } from './navigationBottomPlan';

/** Prefer full labels at natural width; wrap only when that preserves more direct actions. */
export function navigationWrappedPlan(
  input: Parameters<typeof navigationBottomPlan>[0],
  wrappable: readonly boolean[] = input.pageWidths.map(() => true),
  baselinePageWidths: readonly number[] = input.pageWidths.map(() => 88),
  baselineMoreWidth = 44,
) {
  const natural = navigationBottomPlan(input);
  if (
    natural &&
    !natural.overflowNavigation.length &&
    !natural.overflowPages.length
  )
    return {
      plan: natural,
      pageWidths: input.pageWidths,
      moreWidth: input.moreWidth,
      wrapped: false,
    };
  const root = input.navigation.some(action => action.rootTab);
  const at = (cap: number) => {
    const pageWidths = input.pageWidths.map((width, index) =>
      wrappable[index]
        ? Math.max(baselinePageWidths[index] ?? 88, Math.min(width, cap))
        : width,
    );
    const moreWidth = root
      ? input.moreWidth
      : Math.max(baselineMoreWidth, Math.min(input.moreWidth, cap));
    return {
      plan: navigationBottomPlan({ ...input, pageWidths, moreWidth }),
      pageWidths,
      moreWidth,
    };
  };
  const smallest = at(88);
  if (!smallest.plan)
    return natural
      ? {
          plan: natural,
          pageWidths: input.pageWidths,
          moreWidth: input.moreWidth,
          wrapped: false,
        }
      : null;
  if (
    smallest.pageWidths.every(
      (width, index) => width === input.pageWidths[index],
    ) &&
    smallest.moreWidth === input.moreWidth
  )
    return {
      plan: natural ?? smallest.plan,
      pageWidths: input.pageWidths,
      moreWidth: input.moreWidth,
      wrapped: false,
    };
  const signature = (plan: NonNullable<typeof smallest.plan>) =>
    JSON.stringify([plan.navigationIndices, plan.pageIndices]);
  const target = signature(smallest.plan);
  let low = 88;
  let high = Math.max(88, input.moreWidth, ...input.pageWidths);
  for (let i = 0; i < 16; i += 1) {
    const mid = (low + high) / 2;
    const candidate = at(mid);
    if (candidate.plan && signature(candidate.plan) === target) low = mid;
    else high = mid;
  }
  const chosen = at(low);
  return { ...chosen, plan: chosen.plan!, wrapped: true };
}
