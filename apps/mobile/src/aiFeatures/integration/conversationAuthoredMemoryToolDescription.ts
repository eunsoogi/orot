import { exactAuthoredMemorySentence } from '../../storage/authoredMemorySelection';
import {
  isExactStandingAuthoredMemorySentence,
  standingAuthoredMemoryScope,
} from '../../storage/standingAuthoredMemoryApproval';
/** Only an owned, separately opted-in current turn receives the broader nomination instruction. */
export function authoredMemoryToolDescription(
  standing: boolean,
  general: boolean,
) {
  return standing
    ? general
      ? 'Nominate a useful, durable, non-sensitive statement the current user directly stated about themselves (such as a project, goal, hobby, preference, or routine). No remember command is required. Copy the exact whole current utterance or exact complete preference or routine sentence. Never nominate questions, guesses, quotes, third-party information, health, identifiers, credentials, AI output, or prior turns. Local Settings permission is checked separately. Never claim a save without the host receipt.'
      : 'Use only to retain one useful standing reply preference or recurring non-sensitive practice directly stated in the current user message. No remember command is required. Copy its exact complete sentence, never prior turns, questions, speculation, quotes, secrets or other categories. Local Settings permission is checked separately. Never claim a save without the host receipt.'
    : 'Use only when the current user explicitly asks to remember a fact, plan, practice, project, goal or preference they directly state in this same message. Copy exactly one complete factual sentence from the current user message; never copy the request to save, filler, prior replies, quoted text, questions, guesses or credentials. The app displays the exact sentence for local approval. Never claim it was saved without a successful tool result.';
}

/** Reject output outside the narrower instruction even if a dispatched model ignores it. */
export function authoredMemoryToolParser(
  question: string,
  standing: boolean,
  general: boolean,
) {
  const exact = standing
    ? isExactStandingAuthoredMemorySentence
    : exactAuthoredMemorySentence;
  return (value: unknown) => {
    if (
      !value ||
      typeof value !== 'object' ||
      Object.keys(value).length !== 1 ||
      !('statement' in value) ||
      !exact(question, value.statement) ||
      (standing &&
        !general &&
        !standingAuthoredMemoryScope(question, value.statement))
    )
      return undefined;
    return { statement: value.statement };
  };
}
