import type { ProviderCapabilities } from '@orot/model-runtime';
import type { StagedMedicalDocument } from '../medicalDocuments/medicalDocumentNativeBridge';

/** Decides only whether recognized text can be sent; the caller must check the selected provider at dispatch. */
export function photoEvidenceCapability(
  capabilities: ProviderCapabilities,
  document: Pick<StagedMedicalDocument, 'sections'>,
): 'ocr' | 'unsupported' | 'empty' {
  if (!capabilities.inputTypes.includes('text')) return 'unsupported';
  if (!document.sections.some(section => section.text.trim())) return 'empty';
  return 'ocr';
}
