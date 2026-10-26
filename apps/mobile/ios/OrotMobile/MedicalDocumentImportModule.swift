import Foundation
import React
import UIKit
import UniformTypeIdentifiers

/// Presents the user-selected file picker and returns only locally extracted text and provenance.
@objc(MedicalDocumentImportModule)
public final class MedicalDocumentImportModule: NSObject, UIDocumentPickerDelegate {
    private let fileStore = MedicalDocumentFileStore()
    private var pendingPicker: UIDocumentPickerViewController?
    private var pendingPromise: (resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock)?

    @objc public static func requiresMainQueueSetup() -> Bool {
        false
    }

    @objc(pickMedicalDocument:rejecter:)
    public func pickMedicalDocument(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock,
    ) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard pendingPromise == nil else {
                reject("IMPORT_FAILED", "A document selection is already active.", nil)
                return
            }
            guard let presenter = Self.activePresenter() else {
                reject("IMPORT_FAILED", "The document picker is unavailable.", nil)
                return
            }

            let picker = UIDocumentPickerViewController(
                forOpeningContentTypes: [.pdf, .plainText],
                asCopy: false,
            )
            do {
                // Only the native test Simulator build sees this synthetic fixture; production keeps UIKit's normal entry location.
                picker.directoryURL = try MedicalDocumentPickerTestFixtures.prepareDirectoryIfRequested()
            } catch {
                reject("IMPORT_FAILED", "The synthetic document picker fixture is unavailable.", nil)
                return
            }
            picker.allowsMultipleSelection = false
            picker.delegate = self
            pendingPicker = picker
            pendingPromise = (resolve, reject)
            presenter.present(picker, animated: true) {
                guard picker.presentingViewController === presenter else {
                    self.finishPicker()
                    reject("IMPORT_FAILED", "The document picker could not be presented.", nil)
                    return
                }
            }
        }
    }

    @objc(discardMedicalDocument:resolver:rejecter:)
    public func discardMedicalDocument(
        _ sourceID: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock,
    ) {
        perform(resolve: resolve, reject: reject) {
            try self.fileStore.discard(sourceID)
            return NSNull()
        }
    }

    @objc(reconcileMedicalDocumentFiles:resolver:rejecter:)
    public func reconcileMedicalDocumentFiles(
        _ sourceIDs: [String],
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock,
    ) {
        perform(resolve: resolve, reject: reject) {
            try self.fileStore.reconcile(sourceIDs: sourceIDs)
            return NSNull()
        }
    }

    @objc(stageMedicalDocumentDeletion:resolver:rejecter:)
    public func stageMedicalDocumentDeletion(
        _ sourceID: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock,
    ) {
        perform(resolve: resolve, reject: reject) {
            try self.fileStore.stage(sourceID)
            return NSNull()
        }
    }

    @objc(restoreMedicalDocumentDeletion:resolver:rejecter:)
    public func restoreMedicalDocumentDeletion(
        _ sourceID: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock,
    ) {
        perform(resolve: resolve, reject: reject) {
            try self.fileStore.restore(sourceID)
            return NSNull()
        }
    }

    @objc(commitMedicalDocumentDeletion:resolver:rejecter:)
    public func commitMedicalDocumentDeletion(
        _ sourceID: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock,
    ) {
        perform(resolve: resolve, reject: reject) {
            try self.fileStore.commit(sourceID)
            return NSNull()
        }
    }

    public func documentPicker(
        _: UIDocumentPickerViewController,
        didPickDocumentsAt urls: [URL],
    ) {
        guard let promise = finishPicker() else { return }
        guard let url = urls.first else {
            promise.reject("IMPORT_FAILED", "No document was selected.", nil)
            return
        }
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            do {
                guard let self else { throw MedicalDocumentFileStoreFailure.directoryUnavailable }
                let document = try importDocument(at: url)
                promise.resolve(document)
            } catch {
                Self.reject(promise.reject, error: error)
            }
        }
    }

    public func documentPickerWasCancelled(_: UIDocumentPickerViewController) {
        finishPicker()?.resolve(NSNull())
    }

    private func importDocument(at url: URL) throws -> [String: Any] {
        let ext = url.pathExtension.lowercased()
        guard ext == "pdf" || ext == "txt" else {
            throw MedicalDocumentExtractionFailure.unsupportedDocument
        }
        let didStartAccess = url.startAccessingSecurityScopedResource()
        defer {
            if didStartAccess {
                url.stopAccessingSecurityScopedResource()
            }
        }

        let data = try Data(contentsOf: url)
        let extraction = try MedicalDocumentTextExtractor.extract(data: data, fileExtension: ext)
        let identifier = UUID().uuidString.lowercased()
        try fileStore.store(data: data, identifier: identifier, fileExtension: ext)
        return [
            "id": identifier,
            "displayName": url.lastPathComponent,
            "contentHash": extraction.contentHash,
            "sections": extraction.sections.map(\.bridgeValue),
        ]
    }

    private func perform(
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock,
        operation: @escaping () throws -> Any,
    ) {
        DispatchQueue.global(qos: .utility).async {
            do {
                try resolve(operation())
            } catch {
                Self.reject(reject, error: error)
            }
        }
    }

    private func finishPicker() -> (resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock)? {
        pendingPicker = nil
        defer { pendingPromise = nil }
        return pendingPromise
    }

    private static func reject(_ reject: RCTPromiseRejectBlock, error: Error) {
        if let failure = error as? MedicalDocumentExtractionFailure {
            reject(failure.code, "The selected document could not be read.", nil)
        } else if let failure = error as? MedicalDocumentFileStoreFailure {
            switch failure {
            case .fileProtectionUnavailable:
                reject("FILE_PROTECTION_UNAVAILABLE", "Protected document storage is unavailable.", nil)
            case .cleanupFailed:
                reject("CLEANUP_FAILED", "The document file could not be safely removed.", nil)
            case .directoryUnavailable, .invalidIdentifier:
                reject("IMPORT_FAILED", "The document file operation could not be completed.", nil)
            }
        } else {
            reject("IMPORT_FAILED", "The selected document could not be imported.", nil)
        }
    }

    private static func activePresenter() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
        var presenter = scene?.windows.first(where: \.isKeyWindow)?.rootViewController
        while let presented = presenter?.presentedViewController {
            presenter = presented
        }
        return presenter
    }
}
