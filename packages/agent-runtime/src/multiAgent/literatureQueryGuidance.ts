export const EUROPE_PMC_TOOL_ID = 'europe-pmc-publication-search';
export const EUROPE_PMC_SOURCE_ID = 'europe-pmc';

/** Keep source-specific planning instructions identical in system and field guidance. */
export const EUROPE_PMC_QUERY_GUIDANCE =
  'For Europe PMC, use concise literature search keywords, not instructions or the full user question. ' +
  'If the user specifies an exact search query, preserve that query verbatim; omit surrounding instructions to search, summarize, translate, or cite. ' +
  'Otherwise, translate the medical topic into English retrieval keywords. The answer language does not determine the search query language. ' +
  'Preserve medically material qualifiers such as population, condition, intervention, and outcome. ' +
  'Exclude personal identifiers and private record details.';
