import CryptoKit
import Foundation
import ImageIO
@testable import Orot
import UniformTypeIdentifiers
import XCTest

/// Verifies saved-photo lookup, byte identity, MIME selection, and recoverable read failures.
final class MedicalDocumentOriginalPhotoTests: XCTestCase {
    func testOriginalPhotoResolutionPreservesSyntheticImageBytesAndOrientationAfterReopen() throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        try requireMedicalDocumentProtectionSupport(root)
        let store = MedicalDocumentFileStore(rootDirectory: root)
        let reopenedStore = MedicalDocumentFileStore(rootDirectory: root)
        let formats = [
            (
                fileExtension: "jpg",
                typeIdentifier: UTType.jpeg.identifier,
                mimeType: "image/jpeg",
                orientation: CGImagePropertyOrientation.right.rawValue,
            ),
            (
                fileExtension: "heic",
                typeIdentifier: UTType.heic.identifier,
                mimeType: "image/heic",
                orientation: CGImagePropertyOrientation.up.rawValue,
            ),
            (
                fileExtension: "png",
                typeIdentifier: UTType.png.identifier,
                mimeType: "image/png",
                orientation: CGImagePropertyOrientation.up.rawValue,
            ),
        ]

        for format in formats {
            let sourceID = UUID().uuidString.lowercased()
            let bytes = try syntheticImageData(
                typeIdentifier: format.typeIdentifier,
                orientation: format.orientation,
            )
            try store.store(data: bytes, identifier: sourceID, fileExtension: format.fileExtension)

            let photo = try reopenedStore.originalPhoto(
                sourceID: sourceID,
                expectedContentHash: contentHash(bytes),
            )

            XCTAssertEqual(photo["sourceId"], sourceID)
            XCTAssertEqual(photo["mimeType"], format.mimeType)
            XCTAssertEqual(try Data(base64Encoded: XCTUnwrap(photo["base64Data"])), bytes)
            XCTAssertNil(photo["fileURL"])

            let imageSource = try XCTUnwrap(CGImageSourceCreateWithData(bytes as CFData, nil))
            XCTAssertEqual(CGImageSourceGetType(imageSource) as String?, format.typeIdentifier)
            let properties = try XCTUnwrap(
                CGImageSourceCopyPropertiesAtIndex(imageSource, 0, nil) as? [CFString: Any],
            )
            XCTAssertEqual(
                (properties[kCGImagePropertyOrientation] as? NSNumber)?.uint32Value,
                format.orientation,
            )
            XCTAssertEqual((properties[kCGImagePropertyPixelWidth] as? NSNumber)?.intValue, 48)
            XCTAssertEqual((properties[kCGImagePropertyPixelHeight] as? NSNumber)?.intValue, 32)
        }
    }

    func testOriginalPhotoLookupDistinguishesMissingUnsupportedAndCorruptFiles() throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        try requireMedicalDocumentProtectionSupport(root)
        let store = MedicalDocumentFileStore(rootDirectory: root)
        let missingID = UUID().uuidString.lowercased()

        XCTAssertThrowsError(
            try store.originalPhoto(sourceID: missingID, expectedContentHash: nil),
        ) { error in
            guard case MedicalDocumentFileStoreFailure.originalMissing = error else {
                return XCTFail("Expected the saved original to be reported missing.")
            }
        }

        let textID = UUID().uuidString.lowercased()
        try store.store(data: Data("Synthetic note".utf8), identifier: textID, fileExtension: "txt")
        XCTAssertThrowsError(
            try store.originalPhoto(sourceID: textID, expectedContentHash: nil),
        ) { error in
            guard case MedicalDocumentFileStoreFailure.unsupportedOriginal = error else {
                return XCTFail("Expected a text original to be rejected by the photo viewer.")
            }
        }

        let photoID = UUID().uuidString.lowercased()
        let stored = Data("Synthetic image bytes".utf8)
        try store.store(data: stored, identifier: photoID, fileExtension: "jpg")
        XCTAssertThrowsError(try store.originalPhoto(sourceID: photoID, expectedContentHash: nil)) { error in
            guard case MedicalDocumentFileStoreFailure.corruptOriginal = error else {
                return XCTFail("Expected a photo without its saved content hash to fail closed.")
            }
        }
        XCTAssertThrowsError(
            try store.originalPhoto(
                sourceID: photoID,
                expectedContentHash: contentHash(Data("Different bytes".utf8)),
            ),
        ) { error in
            guard case MedicalDocumentFileStoreFailure.corruptOriginal = error else {
                return XCTFail("Expected the changed original to fail its saved hash check.")
            }
        }
        XCTAssertEqual(
            try Data(contentsOf: root.appendingPathComponent("\(photoID).jpg")),
            stored,
        )
    }

    func testOriginalPhotoRejectsMalformedAndAmbiguousSourceIdentityWithoutChangingFiles() throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        try requireMedicalDocumentProtectionSupport(root)
        let store = MedicalDocumentFileStore(rootDirectory: root)

        XCTAssertThrowsError(try store.originalPhoto(sourceID: "not-a-uuid", expectedContentHash: nil)) { error in
            guard case MedicalDocumentFileStoreFailure.corruptOriginal = error else {
                return XCTFail("Expected malformed persisted identity to fail closed as corrupt.")
            }
        }

        let sourceID = UUID().uuidString.lowercased()
        let jpeg = Data("Synthetic JPEG bytes".utf8)
        let png = Data("Synthetic PNG bytes".utf8)
        try store.store(data: jpeg, identifier: sourceID, fileExtension: "jpg")
        try store.store(data: png, identifier: sourceID, fileExtension: "png")

        XCTAssertThrowsError(try store.originalPhoto(sourceID: sourceID, expectedContentHash: nil)) { error in
            guard case MedicalDocumentFileStoreFailure.corruptOriginal = error else {
                return XCTFail("Expected an ambiguous source identity to fail closed as corrupt.")
            }
        }
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("\(sourceID).jpg")), jpeg)
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("\(sourceID).png")), png)
    }

    func testDeletingOnePhotoRetainsTheOtherDocumentOriginal() throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        try requireMedicalDocumentProtectionSupport(root)
        let store = MedicalDocumentFileStore(rootDirectory: root)
        let reopenedStore = MedicalDocumentFileStore(rootDirectory: root)
        let deletedID = UUID().uuidString.lowercased()
        let retainedID = UUID().uuidString.lowercased()
        let deletedBytes = Data("Synthetic deleted photo".utf8)
        let retainedBytes = Data("Synthetic retained photo".utf8)
        try store.store(data: deletedBytes, identifier: deletedID, fileExtension: "jpg")
        try store.store(data: retainedBytes, identifier: retainedID, fileExtension: "png")

        try store.stage(deletedID)
        try store.commit(deletedID)

        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("\(deletedID).jpg").path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(".pending-delete-\(deletedID).jpg").path))
        let retainedPhoto = try reopenedStore.originalPhoto(
            sourceID: retainedID,
            expectedContentHash: contentHash(retainedBytes),
        )
        XCTAssertEqual(try Data(base64Encoded: XCTUnwrap(retainedPhoto["base64Data"])), retainedBytes)
    }

    /// Injects a protected-directory denial so callers can keep the retryable state distinct.
    func testProtectedDirectoryReadFailureRemainsUnavailable() throws {
        let root = temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        try requireMedicalDocumentProtectionSupport(root)
        let manager = InaccessibleDirectoryFileManager()
        let store = MedicalDocumentFileStore(fileManager: manager, rootDirectory: root)

        XCTAssertThrowsError(
            try store.originalPhoto(
                sourceID: UUID().uuidString.lowercased(),
                expectedContentHash: nil,
            ),
        ) { error in
            guard case MedicalDocumentFileStoreFailure.originalUnavailable = error else {
                return XCTFail("Expected protected-file access failure to remain recoverable.")
            }
        }
    }

    private func contentHash(_ data: Data) -> String {
        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        return "sha256:\(digest)"
    }

    /// Builds orientation-tagged test pixels without using a downloaded or personal photo.
    private func syntheticImageData(typeIdentifier: String, orientation: UInt32) throws -> Data {
        let width = 48
        let height = 32
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let context = try XCTUnwrap(
            CGContext(
                data: nil,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: width * 4,
                space: colorSpace,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue,
            ),
        )
        context.setFillColor(CGColor(red: 0.15, green: 0.55, blue: 0.8, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        let image = try XCTUnwrap(context.makeImage())
        let output = NSMutableData()
        let destination = try XCTUnwrap(
            CGImageDestinationCreateWithData(output, typeIdentifier as CFString, 1, nil),
        )
        CGImageDestinationAddImage(
            destination,
            image,
            [kCGImagePropertyOrientation: orientation] as CFDictionary,
        )
        XCTAssertTrue(CGImageDestinationFinalize(destination))
        return output as Data
    }

    private func temporaryRoot() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("medical-document-original-photo-\(UUID().uuidString)", isDirectory: true)
    }
}

private final class InaccessibleDirectoryFileManager: FileManager {
    override func contentsOfDirectory(atPath _: String) throws -> [String] {
        throw CocoaError(.fileReadNoPermission)
    }
}

/// Probe the actual test directory volume; unknown capability fails rather than pretending unsupported.
func requireMedicalDocumentProtectionSupport(_ url: URL) throws {
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    let values = try (url as NSURL).resourceValues(forKeys: [.volumeSupportsFileProtectionKey])
    let supported = try XCTUnwrap(values[.volumeSupportsFileProtectionKey] as? NSNumber, "Test volume file-protection capability unavailable")
    if !supported.boolValue {
        throw XCTSkip("Environment unsupported: test volume explicitly lacks file protection")
    }
}
