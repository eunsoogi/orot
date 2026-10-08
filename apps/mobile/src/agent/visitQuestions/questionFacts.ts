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

function normalizeNumericValue(value: string): string {
  const normalized = value.includes(',')
    ? /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/u.test(value)
      ? value.replaceAll(',', '')
      : value.replace(',', '.')
    : value;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric.toString() : normalized;
}

const NUMERIC_FACT_PATTERN =
  /(?<![\d.,])([+\-−]?\d+(?:[.,]\d+)?(?:\s*\/\s*[+\-−]?\d+(?:[.,]\d+)?)?)(?:\s*(mmol\s*\/\s*l|mg\s*\/\s*(?:dl|kg|day|d)|ml\s*\/\s*day|mmhg|mcg|μg|µg|mg|kg|g|ml|l|cm|mm|°c|°f|℃|%|개월|시간|분|초|회|정|알|개|번|주|일|년|월))?(?![\d.,])/giu;

function structuredQuantityFacts(text: string): string[] {
  const separator = text.indexOf(': ');
  const json = separator < 0 ? text : text.slice(separator + 2);
  if (!json.trimStart().startsWith('{') && !json.trimStart().startsWith('['))
    return [];
  try {
    const facts: string[] = [];
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (!value || typeof value !== 'object') return;
      const object = value as Record<string, unknown>;
      // Domain quantity records encode related values as sibling `amount` and `unit` fields.
      if (
        typeof object.amount === 'number' &&
        Number.isFinite(object.amount) &&
        typeof object.unit === 'string' &&
        object.unit.trim()
      ) {
        facts.push(
          `${normalizeNumericValue(String(object.amount))}\u0000${object.unit.replaceAll(/\s+/gu, '').toLowerCase()}`,
        );
      }
      Object.values(object).forEach(visit);
    };
    visit(JSON.parse(json));
    return facts;
  } catch {
    return [];
  }
}

function numericFacts(text: string): Set<string> {
  // Dates and clock values are separate facts; their components cannot authorize measurements.
  const withoutDates = text
    .replace(
      /(?<!\d)(?:19|20)\d{2}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})/giu,
      ' ',
    )
    .replace(/(?<![\d.,])\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?![\d.,])/gu, ' ')
    .replace(
      /(?<!\d)((?:19|20)\d{2})[-/.](0?[1-9]|1[0-2])(?:[-/.](0?[1-9]|[12]\d|3[01]))?(?!\d)/gu,
      ' ',
    )
    .replace(
      /(?<!\d)((?:19|20)\d{2})\s*년\s*(0?[1-9]|1[0-2])\s*월(?:\s*(0?[1-9]|[12]\d|3[01])\s*일)?/gu,
      ' ',
    );
  const facts = new Set(
    [...withoutDates.matchAll(NUMERIC_FACT_PATTERN)].map(
      ([, expression, unit]) => {
        const normalizedExpression = expression!
          .replaceAll('−', '-')
          .split('/')
          .map(value => normalizeNumericValue(value.trim()))
          .join('/');
        return `${normalizedExpression}\u0000${(unit ?? '').replaceAll(/\s+/gu, '').toLowerCase()}`;
      },
    ),
  );
  structuredQuantityFacts(text).forEach(fact => facts.add(fact));
  return facts;
}

/** Rejects dates and numeric values that do not occur in the appointment or cited source text. */
export function hasUnsupportedDateOrValue(
  text: string,
  citedEvidence: readonly VisitQuestionEvidenceItem[],
  appointmentDate?: string,
): boolean {
  const sourceTexts = [
    appointmentDate ?? '',
    ...citedEvidence.flatMap(item => [item.content, item.effectiveTime ?? '']),
  ];
  const sourceText = sourceTexts.join(' ');
  // Parse each source separately so adjacent appointment/time text cannot hide a JSON quantity object.
  const supportedNumbers = new Set(
    sourceTexts.flatMap(value => [...numericFacts(value)]),
  );
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
