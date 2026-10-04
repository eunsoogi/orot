export interface SyntheticSpeechAccuracyCase {
  readonly id: string;
  readonly expectedText: string;
  readonly medicationName?: string;
  readonly numberForms?: readonly string[];
  readonly negationForms?: readonly string[];
}

export interface SyntheticSpeechAccuracyResult {
  readonly id: string;
  readonly exactMatchAfterNormalization: boolean;
  readonly characterErrorRate: number;
  readonly expectedCharacterCount: number;
  readonly editDistance: number;
  readonly medicationNameMatched?: boolean;
  readonly numberMatched?: boolean;
  readonly negationMatched?: boolean;
}

const DECIMAL_MARKER = '\uE000';
const NEGATIVE_SIGN_MARKER = '\uE001';
const POSITIVE_SIGN_MARKER = '\uE002';

// Keep surface transcription error separate from focused clinical terms so numeric formatting cannot hide character edits.
export function evaluateSyntheticSpeech(
  testCase: SyntheticSpeechAccuracyCase,
  recognizedText: string,
): SyntheticSpeechAccuracyResult {
  const expected = normalizeForAccuracy(testCase.expectedText);
  const actual = normalizeForAccuracy(recognizedText);
  const editDistance = levenshtein(Array.from(expected), Array.from(actual));
  const focus = normalizeForFocus(recognizedText);

  return {
    id: testCase.id,
    exactMatchAfterNormalization: expected === actual,
    characterErrorRate: editDistance / Math.max(Array.from(expected).length, 1),
    expectedCharacterCount: Array.from(expected).length,
    editDistance,
    ...(testCase.medicationName ? {
      medicationNameMatched: focus.includes(normalizeForFocus(testCase.medicationName)),
    } : {}),
    // Number retention accepts fixture-declared spoken or numeric forms while exact match and CER preserve numeric meaning.
    ...(testCase.numberForms ? {
      // The number boundary prevents a shorter value such as 500 from matching the tail of 1500.
      numberMatched: testCase.numberForms.some(form => matchesNumberForm(actual, form)),
    } : {}),
    ...(testCase.negationForms ? {
      // Match action-linked fixture phrases so an unrelated word such as "안심" cannot count as preserved negation.
      negationMatched: testCase.negationForms.some(form => focus.includes(normalizeForFocus(form))),
    } : {}),
  };
}

function normalizeForFocus(value: string): string {
  return value.normalize('NFC').toLowerCase().replace(/[\s.,!?;:()[\]{}"“”'‘’、。，！？…·-]/gu, '');
}

function matchesNumberForm(text: string, value: string): boolean {
  const form = normalizeForAccuracy(value);
  if (!form) return false;
  const startsWithNumber = isNumberCharacter(form[0]);
  const endsWithNumber = isNumberCharacter(form[form.length - 1]);
  let index = text.indexOf(form);
  while (index >= 0) {
    const previous = index > 0 ? text[index - 1] : undefined;
    const nextIndex = index + form.length;
    const next = nextIndex < text.length ? text[nextIndex] : undefined;
    const startsAtNumberBoundary = !startsWithNumber || !previous || !isNumberCharacter(previous);
    const endsAtNumberBoundary = !endsWithNumber || !next || !isNumberCharacter(next);
    if (startsAtNumberBoundary && endsAtNumberBoundary) return true;
    index = text.indexOf(form, index + 1);
  }
  return false;
}

function isNumberCharacter(value: string | undefined): boolean {
  return value !== undefined && (
    /^[0-9영공일이삼사오육칠팔구십백천만억]$/u.test(value)
    || [DECIMAL_MARKER, NEGATIVE_SIGN_MARKER, POSITIVE_SIGN_MARKER].includes(value)
  );
}

function normalizeForAccuracy(value: string): string {
  const compact = value.normalize('NFC').toLowerCase().replace(/\s/gu, '');
  return compact
    .replace(/([0-9])[.,](?=[0-9])/gu, (_match, digit: string) => digit + DECIMAL_MARKER)
    .replace(/(^|[^0-9])[-−–—](?=[0-9])/gu, (_match, before: string) => before + NEGATIVE_SIGN_MARKER)
    .replace(/(^|[^0-9])\+(?=[0-9])/gu, (_match, before: string) => before + POSITIVE_SIGN_MARKER)
    .replace(/[.,!?;:()[\]{}"“”'‘’、。，！？…·\-+−–—]/gu, '');
}

function levenshtein(source: readonly string[], target: readonly string[]): number {
  let previous = Array.from({ length: target.length + 1 }, (_, index) => index);
  for (let sourceIndex = 0; sourceIndex < source.length; sourceIndex += 1) {
    const current = [sourceIndex + 1];
    for (let targetIndex = 0; targetIndex < target.length; targetIndex += 1) {
      current[targetIndex + 1] = Math.min(
        current[targetIndex] + 1,
        previous[targetIndex + 1] + 1,
        previous[targetIndex] + (source[sourceIndex] === target[targetIndex] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[target.length];
}
