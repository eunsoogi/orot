/** Destinations retained beneath source and provider overlays in the AI flow. */
export type FeatureScreenRoute =
  | 'entry'
  | 'visit-questions'
  | 'disease-hypotheses'
  | 'rag-conversation'
  | 'external-evidence';

/** Names accepted by the shared route controller for the complete AI flow. */
export type AiFeatureRouteName =
  'app-home' | FeatureScreenRoute | 'source-detail' | 'provider-selection';

export function isFeatureScreenRoute(
  route: AiFeatureRouteName,
): route is FeatureScreenRoute {
  return (
    route === 'entry' ||
    route === 'visit-questions' ||
    route === 'disease-hypotheses' ||
    route === 'rag-conversation' ||
    route === 'external-evidence'
  );
}
