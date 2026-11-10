// Only explicit literature requests use this route; a past mention is not a request to search.
const koreanSource = /문헌|논문|학술\s*자료|연구\s*결과/u;
const koreanAction = /설명|요약|찾|검색|알려|분석|비교|근거|무엇|어떤|보여/u;
const englishSource =
  /\b(?:literature|papers?|research articles?|scientific studies)\b/iu;
const englishAction =
  /\b(?:explain|summari[sz]e|find|search|show|describe|compare|review|analy[sz]e|what|which)\b/iu;

/** Recognize an explicit current-turn literature request without inspecting prior messages. */
export function requestsLiteratureExplanation(question: string): boolean {
  const normalized = question.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  // A completed action followed only by thanks is an acknowledgement, not a new search.
  if (
    /^(?:문헌|논문)(?:을|를)?\s*(?:찾아|설명해|요약해)\s*줘서\s*고마워(?:요)?[.!?]*$/u.test(
      normalized,
    )
  )
    return false;
  return (
    (koreanSource.test(normalized) && koreanAction.test(normalized)) ||
    (englishSource.test(normalized) && englishAction.test(normalized))
  );
}
