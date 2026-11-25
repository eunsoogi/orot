/** Closed paint hint, never model text or a mutable surface. */
export type ConversationLayoutSkeleton = {
  readonly kind: 'row' | 'stack';
  readonly slots: 1 | 2 | 3;
};

export type MultiAgentResponderStreamEvent =
  /** The active response accepted the steer into its successor; archive prior partial output first. */
  | { readonly type: 'steering_applied' }
  | { readonly type: 'steering_availability'; readonly mode: 'live' | 'boundary' | 'limit_reached' }
  | { readonly type: 'initial_response'; readonly callId: string; readonly text: string }
  | { readonly type: 'layout_skeleton'; readonly layout?: ConversationLayoutSkeleton }
  | { readonly type: 'started' }
  | { readonly type: 'text_delta'; readonly text: string }
  | { readonly type: 'text_snapshot'; readonly text: string };

/** Local display admission for one first-tool opening already approved by the task's reviewer. */
export type ReviewedInitialToolOpeningObserver = (
  opening: { readonly callId: string; readonly text: string },
  signal: AbortSignal,
) => Promise<boolean>;
