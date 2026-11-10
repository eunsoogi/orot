const populations: Readonly<Record<string, string>> = {
  adults: '성인',
  children: '아동',
  adolescents: '청소년',
  'older adults': '고령자',
};
const exposures: Readonly<Record<string, string>> = {
  sleep: '수면',
  'short sleep': '짧은 수면',
  'short sleep duration': '짧은 수면 시간',
  'physical activity': '신체 활동',
  'sedentary behavior': '좌식 행동',
  smoking: '흡연',
};
const outcomes: Readonly<Record<string, string>> = {
  obesity: '비만',
  'blood pressure': '혈압',
  'sleep quality': '수면의 질',
  'depressive symptoms': '우울 증상',
  'health outcomes': '건강 결과',
};

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
  // Only explicitly reviewed entries are vocabulary; object prototypes are not concepts.
  if (
    !Object.prototype.hasOwnProperty.call(populations, populationMatch[1]) ||
    !Object.prototype.hasOwnProperty.call(exposures, relationMatch[1]) ||
    !Object.prototype.hasOwnProperty.call(outcomes, relationMatch[2])
  )
    return undefined;
  const person = populations[populationMatch[1]];
  const exposure = exposures[relationMatch[1]];
  const outcome = outcomes[relationMatch[2]];
  if (!person || !exposure || !outcome) return undefined;
  // A separate population sentence describes the study; it does not bind every finding to that group.
  return `초록은 연구 대상이 ${person}이라고 설명해요. 선택한 초록 문장에는 ${exposure}과 ${outcome}의 연관성이 서술되어 있어요.`;
}
