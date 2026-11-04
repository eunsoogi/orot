/** This in-memory handle belongs to one conversation; raw cursors never reach a provider. */
export interface ArtifactContinuation {
  readonly query: string;
  readonly cursor: string;
}

/** Only an explicit short follow-up resumes a previous search without a new model request. */
export function requestsArtifactContinuation(question: string): boolean {
  return /^(?:계속|이어서|다음|더\s*(?:찾|보|알려))(?:\s*(?:찾아|찾아줘|찾아주세요|보여줘|보여주세요|결과|해줘|해주세요|주세요))*[.!?\s]*$/u.test(
    question.trim(),
  );
}
