import { NativeModules } from 'react-native';
import {
  MedicalDocumentImportError,
  medicalDocumentNativeBridge,
} from '../medicalDocumentNativeBridge';
import type { StoredMedicalDocumentPhoto } from '../medicalDocumentNativeBridge';

/** Keeps source identity and hash verification attached to the native photo read. */
test('loads the saved original for the requested source identity and hash', async () => {
  const previousNativeModule = NativeModules.MedicalDocumentImportModule;
  const sourceId = 'saved-photo-source';
  const expectedContentHash = `sha256:${'d'.repeat(64)}`;
  const photo: StoredMedicalDocumentPhoto = {
    sourceId,
    mimeType: 'image/heic',
    base64Data: 'c3ludGhldGlj',
  };
  const loadMedicalDocumentOriginalPhoto = jest.fn().mockResolvedValue(photo);
  NativeModules.MedicalDocumentImportModule = {
    loadMedicalDocumentOriginalPhoto,
  };

  try {
    await expect(
      medicalDocumentNativeBridge.loadOriginalPhoto(
        sourceId,
        expectedContentHash,
      ),
    ).resolves.toEqual(photo);
    expect(loadMedicalDocumentOriginalPhoto).toHaveBeenCalledWith(
      sourceId,
      expectedContentHash,
    );
  } finally {
    if (previousNativeModule === undefined) {
      delete NativeModules.MedicalDocumentImportModule;
    } else {
      NativeModules.MedicalDocumentImportModule = previousNativeModule;
    }
  }
});

test.each([
  { sourceId: 'different-source', mimeType: 'image/jpeg', base64Data: 'aQ==' },
  { sourceId: 'saved-photo-source', mimeType: 'image/gif', base64Data: 'aQ==' },
  { sourceId: 'saved-photo-source', mimeType: 'image/jpeg', base64Data: '' },
])('rejects an invalid original-photo bridge payload: %o', async payload => {
  const previousNativeModule = NativeModules.MedicalDocumentImportModule;
  NativeModules.MedicalDocumentImportModule = {
    loadMedicalDocumentOriginalPhoto: jest.fn().mockResolvedValue(payload),
  };

  try {
    await expect(
      medicalDocumentNativeBridge.loadOriginalPhoto(
        'saved-photo-source',
        `sha256:${'d'.repeat(64)}`,
      ),
    ).rejects.toMatchObject({ code: 'CORRUPT_ORIGINAL' });
  } finally {
    if (previousNativeModule === undefined) {
      delete NativeModules.MedicalDocumentImportModule;
    } else {
      NativeModules.MedicalDocumentImportModule = previousNativeModule;
    }
  }
});

test('preserves distinct missing-original failures from native storage', async () => {
  const previousNativeModule = NativeModules.MedicalDocumentImportModule;
  NativeModules.MedicalDocumentImportModule = {
    loadMedicalDocumentOriginalPhoto: jest
      .fn()
      .mockRejectedValue(new MedicalDocumentImportError('ORIGINAL_MISSING')),
  };

  try {
    await expect(
      medicalDocumentNativeBridge.loadOriginalPhoto(
        'saved-photo-source',
        `sha256:${'d'.repeat(64)}`,
      ),
    ).rejects.toMatchObject({ code: 'ORIGINAL_MISSING' });
  } finally {
    if (previousNativeModule === undefined) {
      delete NativeModules.MedicalDocumentImportModule;
    } else {
      NativeModules.MedicalDocumentImportModule = previousNativeModule;
    }
  }
});
