import Foundation

/// Names storage failures so the bridge can preserve retry, integrity, and cleanup outcomes.
enum MedicalDocumentFileStoreFailure: Error {
    case directoryUnavailable
    case invalidIdentifier
    case fileProtectionUnavailable
    case cleanupFailed
    case originalMissing
    case originalUnavailable
    case unsupportedOriginal
    case corruptOriginal
}
