export type MultiAgentResponderStreamEvent =
  /** The active response accepted the steer into its successor; archive prior partial output first. */
  | { readonly type: 'steering_applied' }
  | { readonly type: 'steering_availability'; readonly mode: 'live' | 'boundary' | 'limit_reached' }
  | { readonly type: 'initial_response'; readonly callId: string; readonly text: string }
  | { readonly type: 'started' }
  | { readonly type: 'text_delta'; readonly text: string }
  | { readonly type: 'text_snapshot'; readonly text: string };
