import type { ConversationScreenProps } from './ConversationScreenProps';
import { t } from '../i18n';

// Route only a complete creation request. Do not infer a medical task from a
// quoted phrase, ordinary symptoms, or a request to revise a historic report.
const focus = String.raw`[가-힣A-Za-z0-9\s·()]{1,65}(?:위주로|중심으로|관련해서|바탕으로)`;
const polite = String.raw`\s*(?:줘(?:요)?|주세요|주실래요|주실\s*수\s*있나요|줄\s*수\s*있나요)?`;
const create = String.raw`(?:만들어|작성해|생성해|준비해|정리해|요청해)${polite}`;
const tail = String.raw`(?:[.!?]\s*${focus})?[.!?]?`;
const possibilities = new RegExp(
  String.raw`^(?:${focus}\s+)?질병\s*가능성\s*보고서(?:를|을)?\s*(?:${focus}\s+)?${create}${tail}$`,
  'u',
);
const summary = new RegExp(
  String.raw`^(?:최근\s*)?(?:내\s*)?건강\s*(?:정보|기록)(?:를|을)?\s*(?:${focus}\s+)?요약해${polite}${tail}$`,
  'u',
);

export function typedConversationReportIntent(text: string) {
  const value = text.trim().normalize('NFC');
  if (!value || value.length > 140 || /말고|말아|않|아니라|대신/u.test(value))
    return undefined;
  if (
    value === t('conversationActions.possibilities') ||
    value === t('conversationTemplate.possibilities.title') ||
    value === t('conversationIntent.possibilities') ||
    possibilities.test(value)
  )
    return 'possibilities' as const;
  if (
    value === t('conversationActions.healthSummary') ||
    value === t('conversationIntent.healthSummary') ||
    summary.test(value)
  )
    return 'health-summary' as const;
}

/** Only the current authored composer turn receives an explicit template
 * marker. Existing target coordinates and shortcut retry owners take priority. */
export function withTypedComposerReport(
  send: ConversationScreenProps['onSend'],
): ConversationScreenProps['onSend'] {
  return (question, history, signal, observer, context) => {
    const intent =
      observer?.inputOrigin === 'composer' &&
      !observer.photoInput &&
      !context?.appointmentId &&
      !context?.dailyReport &&
      (!context ||
        context.intent === 'conversation' ||
        context.intent === 'possibilities')
        ? typedConversationReportIntent(question)
        : undefined;
    if (!intent)
      return context
        ? send(question, history, signal, observer, context)
        : send(question, history, signal, observer);
    return send(question, history, signal, observer, {
      intent,
      entryKey: `typed:${intent}`,
      ...(intent === 'possibilities' ? { typedPossibilityReport: true } : {}),
    });
  };
}
