import { requestsLiteratureExplanation } from '../../ragConversation/literatureIntent';

export const europePmcConversationTool = 'europe-pmc-publication-search';

/** Only a positive, specific route opts out of ordinary native web search.
 * Free-form mentions, negation, and mixed requests keep existing behavior. */
export function explicitConversationLiteratureRoute(
  question: string,
  entryIntent?: unknown,
): boolean {
  const text = question.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  return (
    requestsLiteratureExplanation(text) &&
    (entryIntent === 'medical-literature' || /\bEurope\s+PMC\b/iu.test(text)) &&
    !/웹\s*검색|\b(?:ChatGPT|public web|web search)\b|말고|아닌|제외|하지\s*마|\b(?:not|instead of|without|exclude)\b/iu.test(
      text,
    )
  );
}
