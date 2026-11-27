import type { DailyReportOutput, DailyReportSourceRecord } from '@orot/domain';
import type { dailyReportActionCandidates } from './dailyReportActions';
import type { ProjectedReportModelClaim } from './dailyReportModelAnalysis';
import { t } from '../../i18n';

type Claim = DailyReportOutput['supportedContext'][number];
type Source = Claim['sourceReferences'][number];
const sourceKey = ({ source, recordId }: Source) =>
  JSON.stringify([source, recordId]);
function uniqueClaims(claims: readonly Claim[]) {
  const result = new Map<string, Claim>();
  for (const claim of claims) {
    const prior = result.get(claim.text);
    const refs = [
      ...(prior?.sourceReferences ?? []),
      ...claim.sourceReferences,
    ];
    result.set(claim.text, {
      text: claim.text,
      sourceReferences: [
        ...new Map(refs.map(ref => [sourceKey(ref), ref])).values(),
      ],
    });
  }
  return [...result.values()];
}

export function dailyReportMainClaims(
  claims: DailyReportOutput['supportedContext'],
) {
  const rank = { takeaway: 0, change: 1, follow_up: 2 };
  const concise = claims.filter(item => item.focus !== undefined);
  return concise.length
    ? concise.sort((left, right) => rank[left.focus!] - rank[right.focus!])
    : claims;
}

/** Mark unchanged stored claims in place; keep one copy of reviewed safety prose. */
export function applyDailyReportFocus(
  detail: readonly Claim[],
  main: readonly Claim[],
): Claim[] {
  const keys = (item: Claim) =>
    JSON.stringify([
      item.text,
      [...new Set(item.sourceReferences.map(sourceKey))].sort(),
    ]);
  const result = [...detail];
  for (const claim of main) {
    const key = keys(claim);
    const index = result.findIndex(item => !item.focus && keys(item) === key);
    if (index >= 0) result[index] = { ...result[index]!, focus: claim.focus };
    else result.push(claim);
  }
  return result;
}

/** Primary report is evidence-led and bounded; retained detail remains
 * available on demand and is never retrospectively classified. */
export function composeDailyReportFocus(input: {
  priority: readonly Claim[];
  candidates: ReturnType<typeof dailyReportActionCandidates>;
  comparisons: readonly Claim[];
  generated: readonly ProjectedReportModelClaim[];
  firstSource: DailyReportSourceRecord | undefined;
}): Claim[] {
  const { candidates, priority, comparisons, generated, firstSource } = input;
  const exceptions = candidates.filter(item => item.role === 'exception');
  const grouped = exceptions.length
    ? [
        {
          text: exceptions.map(item => item.text).join(' '),
          sourceReferences: [
            ...new Map(
              exceptions.flatMap(item =>
                item.sourceReferences.map(
                  ref => [sourceKey(ref), ref] as const,
                ),
              ),
            ).values(),
          ],
        },
      ]
    : [];
  const material = uniqueClaims([...grouped, ...comparisons]);
  const known = new Set(
    [...priority, ...material].flatMap(item =>
      item.sourceReferences.map(sourceKey),
    ),
  );
  const interpretation = generated.find(
    item =>
      item.kind === 'interpretation' &&
      item.text.length <= 260 &&
      item.sourceReferences.length >= 2 &&
      item.sourceReferences.every(ref => known.has(sourceKey(ref))),
  );
  const highlights = uniqueClaims([
    ...priority.slice(1),
    ...material,
    ...(interpretation ? [interpretation] : []),
  ]);
  const takeaway =
    priority[0] ??
    highlights.shift() ??
    (firstSource && {
      text: t('dailyReport.analysis.routineTakeaway'),
      sourceReferences: [
        { source: firstSource.source, recordId: firstSource.recordId },
      ],
    });
  if (!takeaway) return [];
  const followUps = uniqueClaims(
    candidates
      .filter(item => item.role === 'follow_up')
      .filter(
        item =>
          item.text !== takeaway.text &&
          !highlights.some(highlight => highlight.text === item.text),
      ),
  );
  const project = (
    claim: Claim,
    focus: NonNullable<Claim['focus']>,
  ): Claim => ({
    text: claim.text,
    sourceReferences: claim.sourceReferences,
    focus,
  });
  return [
    project(takeaway, 'takeaway'),
    ...highlights
      .filter(item => item.text !== takeaway.text)
      .slice(0, 3)
      .map(item => project(item, 'change')),
    ...followUps.slice(0, 2).map(item => project(item, 'follow_up')),
  ];
}

export const dailyReportFocusHeading = (focus: NonNullable<Claim['focus']>) =>
  t(`dailyReport.focus.${focus}`);
