import { parseSourceConversationReport } from './sourceConversationReportTemplate';
import { t } from '../i18n';
import { parseDailyConversationReport } from './dailyConversationReportTemplate';

/** Presentation markers only: never infer a clinical section from unstructured prose.
 * The original answer remains the sole retained/provider-history value. */
export function possibilityReportTemplate() {
  return {
    title: t('conversationTemplate.possibilities.title'),
    sections: [
      t('conversationTemplate.possibilities.observations'),
      t('conversationTemplate.possibilities.explanations'),
      t('conversationTemplate.possibilities.evidence'),
      t('conversationTemplate.possibilities.unknowns'),
      t('conversationTemplate.possibilities.nextSteps'),
    ],
  };
}

export interface ConversationReportSection {
  readonly title: string;
  readonly content: string;
}

/** Accept only a complete explicit report, preserving every body character.
 * Unknown/repeated/missing headings fall back to the intact ordinary answer. */
export function parseConversationReport(content: string) {
  const template = possibilityReportTemplate();
  const title = `# ${template.title}\n`;
  if (!content.startsWith(title)) return parseDailyConversationReport(content);
  const remainder = content.slice(title.length).replace(/^\n+/u, '');
  const sources = parseSourceConversationReport(remainder);
  if (sources) return { title: template.title, sections: sources };
  const sections: ConversationReportSection[] = [];
  let cursor = 0;
  for (const [index, heading] of template.sections.entries()) {
    const marker = `## ${heading}\n`;
    if (!remainder.startsWith(marker, cursor)) return undefined;
    const start = cursor + marker.length;
    const next = remainder.indexOf('\n## ', start);
    const end = next === -1 ? remainder.length : next;
    const body = remainder.slice(start, end);
    if (!body.trim() || /(?:^|\n)#{1,6} /u.test(body)) return undefined;
    sections.push({ title: heading, content: body });
    cursor = end + 1;
    if (index < template.sections.length - 1 && next === -1) return undefined;
    if (index === template.sections.length - 1 && next !== -1) return undefined;
  }
  return { title: template.title, sections };
}

/** A quick choice requests a report; later free-form follow-ups remain natural dialogue.
 * These labels request organization, not extra evidence or a lower validation standard. */
export function possibilityTemplateInstruction(
  question: string,
  intent?: string,
) {
  if (
    intent !== 'possibilities' ||
    question !== t('conversationIntent.possibilities')
  )
    return undefined;
  const template = possibilityReportTemplate();
  return {
    format:
      'For a grounded report, write answer using exactly this Markdown title and these level-two headings in order, each on its own line with nonempty body text. Keep the same citations, clinical uncertainty and evidence requirements. Do not invent content to fill a section; state the specific unknown. For safety refusals or clarification, answer naturally instead. Do not repeat the title or add other headings.',
    title: `# ${template.title}`,
    sections: template.sections.map(heading => `## ${heading}`),
  };
}
