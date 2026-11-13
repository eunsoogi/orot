import '../src/agent/polyfills';
import 'react-native-get-random-values';
import { AppRegistry } from 'react-native';
import type { RecordRepository } from '@orot/storage';
import App from '../App';
import { name as appName } from '../app.json';
import { medicalDocumentFileDeletion } from '../src/medicalDocuments/medicalDocumentNativeBridge';
import { createMedicalDocumentImportService } from '../src/medicalDocuments/medicalDocumentImportService';

// Only this explicit E2E entry substitutes storage; picker presentation and completion remain native.
const syntheticRepository = {
  list: async () => [],
} as unknown as RecordRepository;
const pickerService = createMedicalDocumentImportService({
  loadRepository: async () => syntheticRepository,
  // The probe owns no retained conversation originals and must not open user storage.
  retainedConversationSourceIds: async () => [],
  fileDeletion: { ...medicalDocumentFileDeletion, reconcile: async () => {} },
});
export const pickerRecoveryProbeService = {
  ...pickerService,
  getDocument: async () => null,
  saveDocument: async () => {
    throw new Error('Saving is outside the picker recovery probe');
  },
};

function MedicalDocumentPickerRecoveryProbeEntry() {
  return <App documentImportService={pickerRecoveryProbeService} />;
}

AppRegistry.registerComponent(
  appName,
  () => MedicalDocumentPickerRecoveryProbeEntry,
);
