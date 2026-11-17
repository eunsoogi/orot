import { t } from '../i18n';

/** Source-backed composition has no validated personal differential. Its app-owned
 * headings identify source categories, never inferred diagnoses or probabilities.
 * Source text may itself contain Markdown; retain it instead of rejecting its body. */
export function parseSourceConversationReport(content: string) {
  const fallbackTitle = t('conversationTemplate.possibilities.verifiedSources');
  const fallbackMarker = `## ${fallbackTitle}\n`;
  if (
    content.startsWith(fallbackMarker) &&
    content.slice(fallbackMarker.length).trim()
  )
    return [
      { title: fallbackTitle, content: content.slice(fallbackMarker.length) },
    ];
  const titles: string[] = [
    t('conversationTemplate.possibilities.records'),
    t('conversationTemplate.possibilities.literature'),
    t('conversationTemplate.possibilities.comparisonLimits'),
  ];
  const markers = [...content.matchAll(/^## (.+)\n/gmu)].filter(match =>
    titles.includes(match[1]!),
  );
  if (!markers.length || markers[0]!.index !== 0) return undefined;
  let previous = -1;
  const sections = [];
  for (const [i, marker] of markers.entries()) {
    const title = marker[1]!;
    const order = titles.indexOf(title);
    if (order <= previous) return undefined;
    previous = order;
    const body = content.slice(
      marker.index! + marker[0].length,
      markers[i + 1]?.index ?? content.length,
    );
    if (!body.trim()) return undefined;
    sections.push({ title, content: body });
  }
  return sections;
}

/** If literal source text collides with category markers, keep the complete validated
 * body in one neutral source section instead of reclassifying or dropping it. */
export function serializeSourceConversationReport(
  sections: readonly { title: string; content: string }[],
  body: string,
) {
  const content = sections
    .map(section => `## ${section.title}\n${section.content}`)
    .join('\n\n');
  const parsed = parseSourceConversationReport(content);
  const exact =
    parsed?.length === sections.length &&
    parsed.every(
      (section, i) =>
        section.title === sections[i]!.title &&
        section.content.trimEnd() === sections[i]!.content.trimEnd(),
    );
  return `# ${t('conversationTemplate.possibilities.title')}\n\n${exact ? content : `## ${t('conversationTemplate.possibilities.verifiedSources')}\n${body}`}`;
}
