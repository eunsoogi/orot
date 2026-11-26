const maxPhotoBytes = 2 * 1024 * 1024;
const maxBase64 = 4 * Math.ceil(maxPhotoBytes / 3);

/** Only accept bounded inline JPEG strings. ImageIO and the native decoder check the actual bytes. */
export function isBoundedInlineJPEG(value: string): boolean {
  if (
    typeof value !== 'string' ||
    value.length < 8 ||
    value.length > maxBase64 ||
    value.length % 4 !== 0 ||
    !value.startsWith('/9j/')
  )
    return false;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const data = padding ? value.slice(0, -padding) : value;
  return 3 * (value.length / 4) - padding <= maxPhotoBytes && !/[^A-Za-z0-9+/]/.test(data);
}
