import { captureDirectPhotoGroup } from '@orot/provider-openai';

/** Cancellation preserves the previous settled group; a partial replacement never becomes sendable. */
export async function pickDirectPhotoGroup(
  pick: () => Promise<string | readonly string[] | null>,
  previous: readonly string[] | undefined,
) {
  const value = await pick();
  if (value === null) return previous;
  const images = captureDirectPhotoGroup(
    typeof value === 'string' ? [value] : value,
  );
  if (!images) throw new Error('Invalid picker image.');
  return images;
}
