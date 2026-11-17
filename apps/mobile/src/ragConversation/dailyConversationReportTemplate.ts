import { t } from '../i18n';

/** Known serializer headings, not keyword classification of a medical narrative. */
export function dailyConversationReportHeadings() {
  return [
    t('dailyReport.supportedContext'),
    t('dailyReport.analysis.priority'),
    t('dailyReport.analysis.actions'),
    t('dailyReport.analysis.history'),
    t('dailyReport.analysis.patterns'),
    t('dailyReport.analysis.limits'),
    t('dailyReport.analysis.plans'),
    t('dailyReport.analysis.model'),
    t('dailyReport.observations'),
    t('dailyReport.suggestedQuestions'),
    t('conversationTemplate.daily.scope'),
  ];
}

/** New reports retain explicit structure in their original answer string. Legacy
 * prose is kept intact rather than guessing which paragraphs represent sections. */
export function parseDailyConversationReport(content: string) {
  const title = t('dailyReport.title');
  const prefix = `# ${title}\n\n`;
  if (!content.startsWith(prefix)) return undefined;
  const parts = content.slice(prefix.length).split('\n\n## ');
  if (parts.length < 2) return undefined;
  const introduction = parts.shift()!;
  if (/(?:^|\n)#{1,6} /u.test(introduction)) return undefined;
  const allowed = new Set(dailyConversationReportHeadings());
  const sections = [];
  for (const part of parts) {
    const newline = part.indexOf('\n');
    if (newline === -1) return undefined;
    const heading = part.slice(0, newline);
    const body = part.slice(newline + 1);
    if (!allowed.has(heading) || !body.trim() || /(?:^|\n)#{1,6} /u.test(body))
      return undefined;
    sections.push({ title: heading, content: body });
  }
  return { title, introduction, sections };
}
