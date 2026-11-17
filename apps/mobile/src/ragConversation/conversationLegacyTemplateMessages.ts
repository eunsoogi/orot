import type { LanguageModelMessage } from '@orot/model-runtime';

/** Old protected checkpoints must not acquire new formatting instructions on resume.
 * Only app-serialized task JSON is accepted here; all other fields/order are preserved. */
export function withoutReportTemplate(
  messages: readonly LanguageModelMessage[],
): readonly LanguageModelMessage[] {
  return messages.map(message => {
    if (message.role !== 'user' || typeof message.content !== 'string')
      return message;
    const payload = JSON.parse(message.content);
    if (!Object.prototype.hasOwnProperty.call(payload, 'answerTemplate'))
      return message;
    delete payload.answerTemplate;
    return { ...message, content: JSON.stringify(payload) };
  });
}
