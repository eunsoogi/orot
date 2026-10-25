import Foundation
@testable import OpenAIProvider
import XCTest

final class ResponsesSSEDecoderTests: XCTestCase {
    func testDecodesCRLFFramesAcrossArbitraryByteChunks() throws {
        let source = ": keepalive\r\nevent: response.output_text.delta\r\ndata: {\"type\":\"response.output_text.delta\",\r\ndata: \"delta\":\"안녕 🌍\"}\r\n\r\n"
        var decoder = ResponsesSSEDecoder()
        var frames = [ResponsesSSEFrame]()
        for chunk in sseChunks(source, chunkSize: 2) {
            frames += try decoder.append(chunk)
        }

        XCTAssertEqual(frames, [
            ResponsesSSEFrame(
                event: "response.output_text.delta",
                data: "{\"type\":\"response.output_text.delta\",\n\"delta\":\"안녕 🌍\"}",
            ),
        ])
    }

    func testDoesNotDispatchAnUnterminatedFrameAtEOF() throws {
        var decoder = ResponsesSSEDecoder()
        XCTAssertTrue(try decoder.append(Data("data: partial".utf8)).isEmpty)
        XCTAssertTrue(try decoder.finish().isEmpty)
    }

    func testRejectsInvalidUTF8InACompletedLine() {
        var decoder = ResponsesSSEDecoder()
        XCTAssertThrowsError(try decoder.append(Data([0xFF, 0x0A]))) { error in
            XCTAssertEqual(error as? ResponsesSSEError, .invalidUTF8)
        }
    }
}
