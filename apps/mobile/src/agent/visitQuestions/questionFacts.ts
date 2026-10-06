import type { VisitQuestionEvidenceItem } from './taskContract';

interface DateFact {
  readonly year: number;
  readonly month: number;
  readonly day?: number;
}

function dateFacts(text: string): DateFact[] {
  const facts: DateFact[] = [];
  const patterns = [
    /(?<!\d)((?:19|20)\d{2})[-/.](0?[1-9]|1[0-2])(?:[-/.](0?[1-9]|[12]\d|3[01]))?(?!\d)/gu,
    /(?<!\d)((?:19|20)\d{2})\s*년\s*(0?[1-9]|1[0-2])\s*월(?:\s*(0?[1-9]|[12]\d|3[01])\s*일)?/gu,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const [, year, month, day] = match;
      facts.push({
        year: Number(year),
        month: Number(month),
        ...(day ? { day: Number(day) } : {}),
      });
    }
  }
  return facts;
}

function normalizeNumericFact(value: string): string {
  const normalized = value.includes(',')
    ? /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/u.test(value)
      ? value.replaceAll(',', '')
      : value.replace(',', '.')
    : value;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric.toString() : normalized;
}

function numericFacts(text: string): Set<string> {
  return new Set(
    [...text.matchAll(/(?<![\d.,])\d+(?:[.,]\d+)?/gu)].map(match =>
      normalizeNumericFact(match[0]),
    ),
  );
}

/** Rejects dates and numeric values that do not occur in the appointment or cited source text. */
export function hasUnsupportedDateOrValue(
  text: string,
  citedEvidence: readonly VisitQuestionEvidenceItem[],
  appointmentDate?: string,
): boolean {
  const sourceText = [
    appointmentDate ?? '',
    ...citedEvidence.flatMap(item => [item.content, item.effectiveTime ?? '']),
  ].join(' ');
  const supportedNumbers = numericFacts(sourceText);
  if ([...numericFacts(text)].some(value => !supportedNumbers.has(value)))
    return true;

  const supportedDates = dateFacts(sourceText);
  return dateFacts(text).some(
    date =>
      !supportedDates.some(
        supported =>
          date.year === supported.year &&
          date.month === supported.month &&
          (date.day === undefined || date.day === supported.day),
      ),
  );
}
