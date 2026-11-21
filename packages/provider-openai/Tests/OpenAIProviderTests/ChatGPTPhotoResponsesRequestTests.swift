import Foundation
@testable import OpenAIProvider
import XCTest

/// Exercises the currently selected Plan adapter's native decoder and real request builder.
/// The fixture bytes stand only for an already-normalized JPEG; no server is contacted.
final class ChatGPTPhotoResponsesRequestTests: XCTestCase {
    private static let syntheticGeometryJPEG = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAAIABADASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAAAAcI/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCMtmAD/9k="

    func testPhotoBecomesInlineImageAndNotOCROrRemoteFile() throws {
        let jpeg = try XCTUnwrap(Data(base64Encoded: Self.syntheticGeometryJPEG))
        let payload: NSDictionary = [
            "model": "gpt-6.2-sol",
            "directPhoto": ["text": "", "jpegBase64": jpeg.base64EncodedString()],
        ]
        XCTAssertThrowsError(try ChatGPTResponsesRequestDecoder.decode(payload))
        let input = try ChatGPTResponsesRequestDecoder.decode(payload, allowDirectPhoto: true)
        let request = try ChatGPTResponsesRequestBuilder.build(input, accessToken: "synthetic-test-token")
        let json = try XCTUnwrap(try JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any])
        XCTAssertEqual(request.url?.absoluteString, "https://api.openai.com/v1/responses")
        XCTAssertEqual(json["store"] as? Bool, false)
        XCTAssertEqual(json["stream"] as? Bool, true)
        XCTAssertNil(json["tools"])
        XCTAssertTrue((json["instructions"] as? String)?.contains("Do not diagnose") == true)
        XCTAssertNil(json["previous_response_id"])
        XCTAssertEqual((json["input"] as? [[String: Any]])?.count, 1)
        let content = ((json["input"] as? [[String: Any]])?.first?["content"] as? [[String: String]])
        XCTAssertEqual(content, [["type": "input_image", "image_url": "data:image/jpeg;base64," + jpeg.base64EncodedString(), "detail": "auto"]])
    }

    func testDedicatedPhotoEntryRequiresTheExactSupportedModelAndEnvelope() {
        for model in ["gpt-6.2-sol-unlisted", "gpt-6-luna"] {
            XCTAssertThrowsError(try ChatGPTResponsesRequestDecoder.decode([
                "model": model,
                "directPhoto": ["text": "", "jpegBase64": Self.syntheticGeometryJPEG],
            ], allowDirectPhoto: true))
        }
        XCTAssertThrowsError(try ChatGPTResponsesRequestDecoder.decode([
            "model": "gpt-6.2-sol",
            "publicWebQuery": "synthetic controlled query",
        ], allowDirectPhoto: true))
    }

    func testCannotMixPhotoAndHistoryOrProvideURL() {
        XCTAssertThrowsError(try ChatGPTResponsesRequestDecoder.decode([
            "model": "gpt-6.2-sol",
            "directPhoto": ["text": "", "imageURL": "https://example.invalid/photo"],
        ], allowDirectPhoto: true))
        XCTAssertThrowsError(try ChatGPTResponsesRequestDecoder.decode([
            "model": "gpt-6.2-sol",
            "directPhoto": ["text": "", "jpegBase64": "/9j/2Q=="],
            "messages": [["role": "user", "content": "old message"]],
        ], allowDirectPhoto: true))
        let mixed = ChatGPTResponsesRequest(model: "gpt-6.2-sol", messages: [
            .userPhoto(text: "", normalizedJPEG: Data([0xff, 0xd8, 0xff, 0xd9])),
            .user("old message"),
        ])
        XCTAssertThrowsError(try ChatGPTResponsesRequestBuilder.build(mixed, accessToken: "synthetic-test-token"))
    }
}
