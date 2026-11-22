/** Early display uses fixed names for exact public OpenAI IDs. The account's
 * dynamic catalog alone decides which choices exist and are ready. Never display
 * an opaque saved identifier or a provider/account ID. */
export function savedChatGPTModelLabel(modelId: string): string | undefined {
  switch (modelId) {
    case 'gpt-6.2-astra':
      return 'GPT-6.2 Astra';
    case 'gpt-6.2-sol':
      return 'GPT-6.2 Sol';
    case 'gpt-6-luna':
      return 'GPT-6 Luna';
    case 'gpt-5.6-sol':
      return 'GPT-5.6 Sol';
    case 'gpt-5.4':
      return 'GPT-5.4';
    default:
      return undefined;
  }
}
