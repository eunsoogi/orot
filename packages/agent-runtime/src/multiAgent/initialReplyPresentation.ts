/** Read a neutral descriptor, never model-provided native layout, data or actions. */
export function readInitialReplyPresentation(
  raw: string,
): { readonly text: string; readonly layout?: 'card' } | undefined {
  if (!raw.startsWith('{')) return { text: raw };
  if (raw.length > 1_024) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !('text' in value) ||
      typeof value.text !== 'string'
    )
      return undefined;
    const onlyLayout = Object.keys(value).every(key => key === 'text' || key === 'layout');
    return {
      text: value.text,
      ...(onlyLayout && 'layout' in value && value.layout === 'card' ? { layout: 'card' } : {}),
    };
  } catch {
    return undefined;
  }
}
