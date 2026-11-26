import { isBoundedInlineJPEG } from './direct-photo-jpeg';

const maximumPhotos = 3;
const maximumTotalBytes = 4 * 1024 * 1024;

/** Capture an exact ordered transient group for approval, never a storage ID
 * or transfer authorization. Any invalid item rejects the entire selection. */
export function captureDirectPhotoGroup(input: unknown): readonly string[] | undefined {
  if (!Array.isArray(input) || input.length < 1 || input.length > maximumPhotos) return;
  const count = input.length;
  const photos: string[] = [];
  let totalBytes = 0;
  for (let index = 0; index < count; index++) {
    const value: unknown = input[index];
    if (typeof value !== 'string' || !isBoundedInlineJPEG(value)) return;
    const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
    totalBytes += (value.length / 4) * 3 - padding;
    if (totalBytes > maximumTotalBytes) return;
    photos.push(value);
  }
  return Object.freeze(photos);
}
