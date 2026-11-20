/** A settings decision has no runtime request, records, messages, or preview. */
export interface SettingsDisclosureSummary {
  readonly providerId: string;
  readonly modelId: string;
  readonly recipient: string;
  readonly subtitle: string;
  readonly information: string;
  readonly notice: string;
}
