import type { JsonObject } from '@orot/model-runtime';

export type ComputedFact = Record<string, unknown>;
export const factObject = (value: unknown): value is ComputedFact =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
export const finiteFact = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export interface StatisticChoice {
  readonly key: string;
  readonly description: string;
  readonly texts: Readonly<Record<string, string>>;
}

/** Selectors carry no model-authored amounts or claims. Every accepted choice binds
 * to a precomputed source value; missing/extra keys never become a partial result. */
export function statisticChoiceSchema(
  choices: readonly StatisticChoice[],
): JsonObject {
  return {
    type: 'object',
    additionalProperties: false,
    required: choices.map(choice => choice.key),
    properties: Object.fromEntries(
      choices.map(choice => [
        choice.key,
        {
          type: 'string',
          enum: Object.keys(choice.texts),
          description: choice.description,
        },
      ]),
    ),
  };
}

export function renderStatisticChoices(
  value: unknown,
  choices: readonly StatisticChoice[],
): string | undefined {
  if (!factObject(value) || Object.keys(value).length !== choices.length)
    return;
  const texts: string[] = [];
  for (const choice of choices) {
    const selected = value[choice.key];
    if (typeof selected !== 'string' || !Object.hasOwn(choice.texts, selected))
      return;
    texts.push(choice.texts[selected]!);
  }
  return texts.join('\n');
}

/** Source occurrence times use its explicit calendar zone; absent zones are visibly UTC. */
export function statisticSourceTime(
  value: unknown,
  source: ComputedFact,
): string | undefined {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return;
  const zone =
    factObject(source.period) && typeof source.period.timeZone === 'string'
      ? source.period.timeZone
      : 'UTC';
  try {
    return `${new Date(value).toLocaleString('ko-KR', { timeZone: zone })} (${zone})`;
  } catch {
    return `${new Date(value).toISOString()} (UTC)`;
  }
}

/** The exclusive endpoint is not another recorded day. Calendar labels use the
 * original source zone; partial-day coverage remains explicit. */
export function statisticSourcePeriod(
  source: ComputedFact,
): string | undefined {
  const period = source.period;
  if (
    !factObject(period) ||
    typeof period.fromInclusive !== 'string' ||
    typeof period.toExclusive !== 'string' ||
    typeof period.timeZone !== 'string'
  )
    return;
  const from = Date.parse(period.fromInclusive),
    to = Date.parse(period.toExclusive);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) return;
  try {
    const date = (time: number) =>
      new Date(time).toLocaleDateString('ko-KR', {
        timeZone: period.timeZone as string,
      });
    return `집계 기간 ${date(from)} ~ ${date(to - 1)} (${period.timeZone})${Array.isArray(source.partialDates) && source.partialDates.length ? ' · 일부 날짜는 하루 중 일부만 포함' : ''}.`;
  } catch {
    return;
  }
}
