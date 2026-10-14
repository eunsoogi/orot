import CryptoKit
import Foundation
import XCTest

/// The original synthetic inputs are reused byte-for-byte; recognized text comes from Apple, not the fixture.
struct SpeechFixture: Decodable {
    struct Audio: Decodable {
        let base64: String
        let sha256: String
        let mediaType: String
        let durationSeconds: Double
    }

    struct Item: Decodable {
        let id: String
        let expectedText: String
        let audio: Audio
    }

    let schemaVersion: Int
    let cases: [Item]

    static func item(_ id: String, bundle: Bundle) throws -> Item {
        let url = try XCTUnwrap(bundle.url(forResource: "synthetic-korean", withExtension: "json"))
        let fixture = try JSONDecoder().decode(Self.self, from: Data(contentsOf: url))
        XCTAssertEqual(fixture.schemaVersion, 1)
        let item = try XCTUnwrap(fixture.cases.first { $0.id == id })
        let bytes = try XCTUnwrap(Data(base64Encoded: item.audio.base64))
        let digest = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
        XCTAssertEqual(digest, item.audio.sha256, "The Speech integration test must use the existing Korean fixture")
        return item
    }
}
