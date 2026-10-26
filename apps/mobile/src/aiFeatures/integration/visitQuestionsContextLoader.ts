/** Native storage and embedding modules load only after the user requests generation. */
export function loadVisitQuestionsContext() {
  return import('../../agent/visitQuestions/localContext');
}
