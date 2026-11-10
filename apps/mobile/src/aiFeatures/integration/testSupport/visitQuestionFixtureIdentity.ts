/** Assigns deterministic identities to synthetic generated questions at the review boundary. */
export function assignFixtureQuestionIds<T>(questions: readonly T[]) {
  return questions.map((question, index) => ({
    ...question,
    identity: { id: `synthetic-question-${index}` },
  }));
}
