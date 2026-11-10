import { t } from '../i18n';
import type { TranslationKey } from '../i18n';

const populations = {
  adults: 'externalMedicalEvidence.literature.population.adults',
  children: 'externalMedicalEvidence.literature.population.children',
  adolescents: 'externalMedicalEvidence.literature.population.adolescents',
  'older adults': 'externalMedicalEvidence.literature.population.olderAdults',
} as const satisfies Readonly<Record<string, TranslationKey>>;
const exposures = {
  sleep: 'externalMedicalEvidence.literature.exposure.sleep',
  'short sleep': 'externalMedicalEvidence.literature.exposure.shortSleep',
  'short sleep duration':
    'externalMedicalEvidence.literature.exposure.shortSleepDuration',
  'physical activity':
    'externalMedicalEvidence.literature.exposure.physicalActivity',
  'sedentary behavior':
    'externalMedicalEvidence.literature.exposure.sedentaryBehavior',
  smoking: 'externalMedicalEvidence.literature.exposure.smoking',
} as const satisfies Readonly<Record<string, TranslationKey>>;
const outcomes = {
  obesity: 'externalMedicalEvidence.literature.outcome.obesity',
  'blood pressure': 'externalMedicalEvidence.literature.outcome.bloodPressure',
  'sleep quality': 'externalMedicalEvidence.literature.outcome.sleepQuality',
  'depressive symptoms':
    'externalMedicalEvidence.literature.outcome.depressiveSymptoms',
  'health outcomes':
    'externalMedicalEvidence.literature.outcome.healthOutcomes',
} as const satisfies Readonly<Record<string, TranslationKey>>;

/** Interpret only a fully consumed, source-attributed grammar; unknown context stays unverified. */
export function summarizeSupportedAbstract(
  abstract: string,
  population: string,
  result: string,
  statisticSpan = '',
): string | undefined {
  const full = abstract.trim().toLowerCase();
  const populationText = population.trim().toLowerCase();
  const resultText = result.trim().toLowerCase();
  if (full !== `${populationText} ${resultText}`) return undefined;
  const populationMatch =
    /^(adults|children|adolescents|older adults) were studied\.$/u.exec(
      populationText,
    );
  const suffix = statisticSpan
    ? ` (${statisticSpan.trim().toLowerCase()}).`
    : '.';
  if (!resultText.endsWith(suffix)) return undefined;
  const relation = `${resultText.slice(0, -suffix.length)}.`;
  const relationMatch = /^(.+?) was associated with (.+?)\.$/u.exec(relation);
  if (!populationMatch || !relationMatch) return undefined;
  // Only reviewed vocabulary maps to localized labels; object prototypes are not concepts.
  if (
    !Object.prototype.hasOwnProperty.call(populations, populationMatch[1]) ||
    !Object.prototype.hasOwnProperty.call(exposures, relationMatch[1]) ||
    !Object.prototype.hasOwnProperty.call(outcomes, relationMatch[2])
  )
    return undefined;
  const personKey = populations[populationMatch[1] as keyof typeof populations];
  const exposureKey = exposures[relationMatch[1] as keyof typeof exposures];
  const outcomeKey = outcomes[relationMatch[2] as keyof typeof outcomes];
  if (!personKey || !exposureKey || !outcomeKey) return undefined;
  // A separate population sentence describes the study; it does not bind every finding to that group.
  return t('externalMedicalEvidence.literature.qualitativeSummary', {
    person: t(personKey),
    exposure: t(exposureKey),
    outcome: t(outcomeKey),
  });
}
