import { Platform } from 'react-native';

/** Stable accessory identifiers keep each form field's save/close actions above its keyboard. */
const FORM_INPUT_ACCESSORY_IDS = {
  description: 'symptom-form-description',
  onsetDate: 'symptom-form-onset-date',
  onsetTime: 'symptom-form-onset-time',
  resolvedDate: 'symptom-form-resolved-date',
  resolvedTime: 'symptom-form-resolved-time',
  bodySite: 'symptom-form-body-site',
  severity: 'symptom-form-severity',
};
type FormInputKey = keyof typeof FORM_INPUT_ACCESSORY_IDS;
type FormMode = 'create' | 'edit';

function nativeAccessoryID(field: FormInputKey, mode?: FormMode): string {
  const id = FORM_INPUT_ACCESSORY_IDS[field];
  // Distinct create/edit description props avoid the unchanged-ID reuse boundary.
  return field === 'description' && mode ? `${id}-${mode}` : id;
}

export function formKeyboardFields(mode: FormMode) {
  return (Object.keys(FORM_INPUT_ACCESSORY_IDS) as FormInputKey[]).map(
    field => ({
      nativeID: nativeAccessoryID(field, mode),
      testSuffix: field,
    }),
  );
}

export function formInputAccessoryID(
  field: FormInputKey,
  mode?: FormMode,
): string | undefined {
  return Platform.OS === 'ios' ? nativeAccessoryID(field, mode) : undefined;
}
