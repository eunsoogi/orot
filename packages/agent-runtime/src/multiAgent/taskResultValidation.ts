export type TaskResultValidation<TResult> =
  | { readonly status: 'valid'; readonly value: TResult }
  | { readonly status: 'invalid'; readonly reason: string }
  | { readonly status: 'needs_clarification'; readonly message: string };
/** Task-approved result shape whose display copy may survive an evidence-coverage stop. */
export interface TaskClarificationValue {
  readonly status: 'needs_clarification';
  readonly message: string;
}
