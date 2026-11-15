/** Optional provisional reply policy, separate from grounded final-result validation. */
export interface InitialToolResponseContract {
  /** Optional content-free reply on the first validated native tool selection, never final output. */
  initialToolResponse?(text: string, request?: string): string | undefined;
  /** Review provisional prose with the selected provider before display, within the existing budget.
   * This probabilistic guard is not clinical validation; only non-factual replies are eligible. */
  readonly reviewInitialToolResponse?: boolean;
}
