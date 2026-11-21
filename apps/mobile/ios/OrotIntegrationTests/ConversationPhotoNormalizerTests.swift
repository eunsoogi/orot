import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers
import XCTest
@testable import Orot

final class ConversationPhotoNormalizerTests: XCTestCase {
    func testNoTextGeometryImportsWithBakedOrientationAndNoGPSorExif() throws {
        let context = try XCTUnwrap(CGContext(data: nil, width: 1600, height: 800,
            bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue))
        context.setFillColor(red: 1, green: 0, blue: 0, alpha: 1)
        context.fill(CGRect(x: 0, y: 0, width: 800, height: 800))
        context.setFillColor(red: 0, green: 1, blue: 0, alpha: 1)
        context.fill(CGRect(x: 800, y: 0, width: 800, height: 800))
        let source = NSMutableData()
        let destination = try XCTUnwrap(CGImageDestinationCreateWithData(source, UTType.jpeg.identifier as CFString, 1, nil))
        CGImageDestinationAddImage(destination, try XCTUnwrap(context.makeImage()), [
            kCGImagePropertyOrientation: 6,
            kCGImagePropertyGPSDictionary: [
                kCGImagePropertyGPSLatitude: 1.0,
                kCGImagePropertyGPSLatitudeRef: "N",
                kCGImagePropertyGPSLongitude: 2.0,
                kCGImagePropertyGPSLongitudeRef: "E",
            ],
            kCGImagePropertyExifDictionary: [kCGImagePropertyExifDateTimeOriginal: "2000:01:01 12:00:00"],
        ] as CFDictionary)
        XCTAssertTrue(CGImageDestinationFinalize(destination))
        let output = try ConversationPhotoNormalizer.normalize(pixelContainer: source as Data)
        let imageSource = try XCTUnwrap(CGImageSourceCreateWithData(output as CFData, nil))
        let inputSource = try XCTUnwrap(CGImageSourceCreateWithData(source as CFData, nil))
        let inputProperties = try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(inputSource, 0, nil) as? [CFString: Any])
        XCTAssertNotNil(inputProperties[kCGImagePropertyGPSDictionary])
        let properties = try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(imageSource, 0, nil) as? [CFString: Any])
        XCTAssertEqual(CGImageSourceGetType(imageSource) as String?, UTType.jpeg.identifier)
        XCTAssertEqual(properties[kCGImagePropertyPixelWidth] as? Int, 720)
        XCTAssertEqual(properties[kCGImagePropertyPixelHeight] as? Int, 1440)
        XCTAssertNil(properties[kCGImagePropertyGPSDictionary])
        XCTAssertNil((properties[kCGImagePropertyExifDictionary] as? [CFString: Any])?[kCGImagePropertyExifDateTimeOriginal])
        XCTAssertLessThanOrEqual(output.count, ConversationPhotoNormalizer.maxOutputBytes)
    }

    func testRejectsEmptyMalformedAndOversizedInput() {
        XCTAssertThrowsError(try ConversationPhotoNormalizer.normalize(pixelContainer: Data()))
        XCTAssertThrowsError(try ConversationPhotoNormalizer.normalize(pixelContainer: Data([0xff, 0xd8])))
        XCTAssertThrowsError(try ConversationPhotoNormalizer.normalize(pixelContainer: Data(count: ConversationPhotoNormalizer.maxSourceBytes + 1)))
    }
}
