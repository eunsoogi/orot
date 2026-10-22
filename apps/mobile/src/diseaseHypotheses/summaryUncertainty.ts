import type { JsonValue } from '@orot/model-runtime';

export const SUMMARY_UNCERTAINTY_REASON =
  'Return Korean uncertainty notes or an empty array.';

/** An empty notes array asserts no limitation. Preserve the existing saved text field without interpreting placeholder strings. */
export function prepareSummaryUncertainty(
  sections: JsonValue | undefined,
):
  { status: 'ready'; sections: JsonValue | undefined } | { status: 'invalid' } {
  if (!Array.isArray(sections)) return { status: 'ready', sections };
  const prepared: JsonValue[] = [];
  for (const section of sections) {
    if (
      !section ||
      typeof section !== 'object' ||
      Array.isArray(section) ||
      !Object.hasOwn(section, 'uncertaintyNotes')
    ) {
      prepared.push(section);
      continue;
    }
    const notes = section.uncertaintyNotes;
    if (
      Object.hasOwn(section, 'uncertainty') ||
      !Array.isArray(notes) ||
      notes.length > 3 ||
      notes.some(
        note =>
          typeof note !== 'string' || !note.trim() || !/[가-힣]/u.test(note),
      ) ||
      notes.join('\n').length > 500
    )
      return { status: 'invalid' };
    const fields = Object.fromEntries(
      Object.entries(section).filter(([key]) => key !== 'uncertaintyNotes'),
    );
    prepared.push({ ...fields, uncertainty: notes.join('\n') });
  }
  return { status: 'ready', sections: prepared };
}
