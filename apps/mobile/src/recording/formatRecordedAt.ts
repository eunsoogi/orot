/** Formats ISO recording times in the device's local Korean locale; malformed values stay visible for diagnosis. */
export function formatRecordedAt(recordedAt: string): string {
  const date = new Date(recordedAt);
  return Number.isNaN(date.getTime())
    ? recordedAt
    : date.toLocaleString('ko-KR');
}
