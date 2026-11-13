const photoExtensions = new Set(['jpg', 'jpeg', 'heic', 'heif', 'png']);

/** Uses the saved display-name extension to select the photo reader for a source. */
export function isSavedMedicalDocumentPhoto(
  title: string | null | undefined,
): boolean {
  if (!title) return false;
  const extension = title.slice(title.lastIndexOf('.') + 1).toLowerCase();
  return photoExtensions.has(extension);
}
