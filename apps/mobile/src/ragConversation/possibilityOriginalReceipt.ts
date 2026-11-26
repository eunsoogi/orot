import { fingerprint } from '../aiFeatures/integration/evidenceUtils';

const fresh = Symbol('fresh-possibility-execution');
const accepted = Symbol('accepted-possibility-creation');
export type PossibilityAttempt = Readonly<{ question: string }>;
type Range = readonly [start: number, end: number];
type Seal = Readonly<{
  attempt: PossibilityAttempt;
  prefix: string;
  ranges: readonly Range[];
}>;
export type StoredPossibilityOriginal = Readonly<{
  version: 1;
  revision: string;
  ranges: readonly Range[];
}>;
const maxAnswer = 32_768;

/** Symbol data survives local object spreads but never provider JSON or checkpoint restore. */
export function armPossibilityAttempt(
  context: unknown,
  question: string,
): PossibilityAttempt | undefined {
  if (!context || typeof context !== 'object' || Array.isArray(context)) return;
  const attempt = Object.freeze({ question });
  Object.defineProperty(context, fresh, { value: attempt, enumerable: true });
  return attempt;
}

export function acceptPossibilityCreation<T extends object>(
  result: T,
  context: unknown,
  request: string,
  prefix: string,
  ranges: readonly Range[],
): T {
  if (!context || typeof context !== 'object' || prefix.length > maxAnswer)
    return result;
  const attempt = (context as { [fresh]?: PossibilityAttempt })[fresh];
  if (!attempt || attempt.question !== request) return result;
  return { ...result, [accepted]: { attempt, prefix, ranges } satisfies Seal };
}

export function forwardPossibilityCreation<T extends object>(
  result: T,
  validated: object,
  attempt: PossibilityAttempt | undefined,
): T {
  const seal = (validated as { [accepted]?: Seal })[accepted];
  return seal && seal.attempt === attempt
    ? { ...result, [accepted]: seal }
    : result;
}

export function storePossibilityOriginal(
  outcome: { answer: string },
  question: string,
): StoredPossibilityOriginal | undefined {
  const seal = (outcome as { [accepted]?: Seal })[accepted];
  if (
    !seal ||
    seal.attempt.question !== question ||
    outcome.answer.length > maxAnswer ||
    !outcome.answer.startsWith(seal.prefix)
  )
    return;
  return {
    version: 1,
    revision: fingerprint([1, outcome.answer, seal.ranges]),
    ranges: seal.ranges,
  };
}

export function readPossibilityOriginal(value: unknown, answer: string) {
  if (!value || typeof value !== 'object' || answer.length > maxAnswer) return;
  const body = value as Partial<StoredPossibilityOriginal>;
  if (
    Object.keys(body).length !== 3 ||
    body.version !== 1 ||
    typeof body.revision !== 'string' ||
    !Array.isArray(body.ranges) ||
    body.ranges.length !== 5
  )
    return;
  let previous = -1;
  const sections: string[] = [];
  for (const bounds of body.ranges) {
    if (
      !Array.isArray(bounds) ||
      bounds.length !== 2 ||
      !bounds.every(Number.isSafeInteger)
    )
      return;
    const [start, end] = bounds as [number, number];
    if (start <= previous || end <= start || end > answer.length) return;
    const section = answer.slice(start, end);
    if (!section.trim()) return;
    sections.push(section);
    previous = end;
  }
  if (body.revision !== fingerprint([1, answer, body.ranges])) return;
  return {
    version: 1 as const,
    revision: body.revision,
    sections,
    trailing: answer.slice(previous),
  };
}

export function validPossibilityOriginalArtifact(
  value: Record<string, unknown>,
) {
  return (
    value.possibilityOriginal === undefined ||
    (value.status === 'complete' &&
      value.entryIntent === 'possibilities' &&
      typeof value.answer === 'string' &&
      !value.submittedInput &&
      !value.dailyReport &&
      !value.healthSummary &&
      !value.visitQuestions &&
      !value.treatmentContext &&
      Array.isArray(value.sources) &&
      value.sources.length > 0 &&
      Array.isArray(value.citations) &&
      value.citations.length > 0 &&
      Boolean(readPossibilityOriginal(value.possibilityOriginal, value.answer)))
  );
}
