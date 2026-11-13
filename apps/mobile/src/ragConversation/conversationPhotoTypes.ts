export type PhotoDraftFailure =
  'unsupported' | 'empty' | 'protection' | 'unavailable';

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
