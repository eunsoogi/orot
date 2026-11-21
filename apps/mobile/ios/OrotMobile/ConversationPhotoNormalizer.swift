import Foundation
import ImageIO
import React
import UniformTypeIdentifiers

/// Imports only the one file supplied by the system picker. The returned JPEG
/// contains freshly rendered pixels, not the original image container or metadata.
enum ConversationPhotoNormalizer {
    static let maxSourceBytes = 20 * 1024 * 1024
    static let maxOutputBytes = 2 * 1024 * 1024
    static let longestEdge = 1440
    private static let maxSourcePixels = 80_000_000

    enum InvalidSelection: Error { case unsupportedImage }

    static func normalize(pickerURL: URL) throws -> Data {
        let values = try pickerURL.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
        guard values.isRegularFile == true, let size = values.fileSize,
              (1...maxSourceBytes).contains(size)
        else { throw InvalidSelection.unsupportedImage }
        return try normalize(pixelContainer: Data(contentsOf: pickerURL, options: .mappedIfSafe))
    }

    static func normalize(pixelContainer data: Data) throws -> Data {
        guard (1...maxSourceBytes).contains(data.count),
              let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
              CGImageSourceGetCount(source) == 1,
              let type = CGImageSourceGetType(source) as String?,
              [UTType.jpeg.identifier, UTType.png.identifier, UTType.heic.identifier, UTType.heif.identifier].contains(type),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int, width > 0,
              let height = properties[kCGImagePropertyPixelHeight] as? Int, height > 0,
              width <= maxSourcePixels / height,
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                  kCGImageSourceShouldCacheImmediately: true,
                  kCGImageSourceCreateThumbnailFromImageAlways: true,
                  kCGImageSourceCreateThumbnailWithTransform: true,
                  kCGImageSourceThumbnailMaxPixelSize: longestEdge,
              ] as CFDictionary),
              image.width <= longestEdge, image.height <= longestEdge
        else { throw InvalidSelection.unsupportedImage }

        // Add the transformed CGImage alone. Do not copy properties from the source,
        // which can contain GPS, device/time, filenames or embedded thumbnails.
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil)
        else { throw InvalidSelection.unsupportedImage }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.83] as CFDictionary)
        guard CGImageDestinationFinalize(destination), (1...maxOutputBytes).contains(output.length)
        else { throw InvalidSelection.unsupportedImage }
        return output as Data
    }
}


/// Separate bridge method: legacy document and OCR paths cannot become image uploads.
public extension MedicalDocumentImportModule {
    @objc(pickConversationImage:rejecter:)
    func pickConversationImage(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        pickPhoto(.transientJPEG, resolve: resolve, reject: reject)
    }
}
