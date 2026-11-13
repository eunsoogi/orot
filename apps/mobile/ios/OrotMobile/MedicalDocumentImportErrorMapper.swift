import Foundation
import React

/// Converts internal document failures into stable, privacy-safe React Native errors.
enum MedicalDocumentImportErrorMapper {
    static func reject(_ reject: RCTPromiseRejectBlock, error: Error) {
        if let failure = error as? MedicalDocumentExtractionFailure {
            reject(failure.code, "The selected document could not be read.", nil)
        } else if let failure = error as? MedicalDocumentFileStoreFailure {
            switch failure {
            case .fileProtectionUnavailable:
                reject("FILE_PROTECTION_UNAVAILABLE", "Protected document storage is unavailable.", nil)
            case .cleanupFailed:
                reject("CLEANUP_FAILED", "The document file could not be safely removed.", nil)
            case .originalMissing:
                reject("ORIGINAL_MISSING", "The saved original photo is missing.", nil)
            case .originalUnavailable:
                reject("ORIGINAL_UNAVAILABLE", "The protected original photo is temporarily unavailable.", nil)
            case .unsupportedOriginal:
                reject("UNSUPPORTED_ORIGINAL", "The saved original is not a supported photo.", nil)
            case .corruptOriginal:
                reject("CORRUPT_ORIGINAL", "The saved original photo could not be verified.", nil)
            case .directoryUnavailable, .invalidIdentifier:
                reject("IMPORT_FAILED", "The document file operation could not be completed.", nil)
            }
        } else {
            reject("IMPORT_FAILED", "The selected document could not be imported.", nil)
        }
    }
}
