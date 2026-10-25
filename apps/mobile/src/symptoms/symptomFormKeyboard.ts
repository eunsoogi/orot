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
export const FORM_KEYBOARD_FIELDS = Object.entries(
  FORM_INPUT_ACCESSORY_IDS,
).map(([testSuffix, nativeID]) => ({ nativeID, testSuffix }));

type FormInputKey = keyof typeof FORM_INPUT_ACCESSORY_IDS;

export function formInputAccessoryID(field: FormInputKey): string | undefined {
  return Platform.OS === 'ios' ? FORM_INPUT_ACCESSORY_IDS[field] : undefined;
}
