export type PhotoDraftFailure =
  'unsupported' | 'empty' | 'protection' | 'unavailable';
export type PhotoValidity = { valid: () => boolean; generation?: number };

/** The draft remains non-sendable while its protected original changes owners. */
export type ConversationPhotoState<T> =
  | { readonly status: 'empty' }
  | { readonly status: 'preparing'; readonly photo?: T }
  | { readonly status: 'ready'; readonly photo: T }
  | { readonly status: 'transferring'; readonly photo: T }
  | {
      readonly status: 'error';
      readonly photo?: T;
      readonly reason?: PhotoDraftFailure;
    };

export function previousConversationPhoto<T>(
  state: ConversationPhotoState<T>,
): T | undefined {
  return 'photo' in state ? state.photo : undefined;
}
