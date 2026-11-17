import Foundation
@testable import OpenAIProvider
import XCTest

final class ResponsesSteeringDiagnosticsTests: XCTestCase {
    func testProtocolTypeRequiresSeparateOptInAndBounds() {
        let prefix = "OROT_PROTOCOL_TYPE_DIAGNOSTIC type="
        XCTAssertNil(ResponsesBeforeActiveDiagnostics.protocolMessage(type: "synthetic.event", enabled: false))
        XCTAssertEqual(ResponsesBeforeActiveDiagnostics.protocolMessage(type: "synthetic.event-1_v2", enabled: true),
                       prefix + "synthetic.event-1_v2")
        XCTAssertEqual(ResponsesBeforeActiveDiagnostics.protocolMessage(type: String(repeating: "a", count: 64), enabled: true),
                       prefix + String(repeating: "a", count: 64))
    }

    func testProtocolTypeRejectsInvalidShapeWithoutEchoingIt() {
        for type in ["", "1event", "Upper", "two words", "https://example.test", "event/path", "event?query", "event\ntext",
                     "évent", String(repeating: "a", count: 65)]
        {
            XCTAssertEqual(ResponsesBeforeActiveDiagnostics.protocolMessage(type: type, enabled: true),
                           "OROT_PROTOCOL_TYPE_DIAGNOSTIC type=invalid")
        }
    }

    func testBeforeActiveEventVocabularyIsClosedAndOptIn() {
        for event in ResponsesBeforeActiveDiagnostics.Event.allCases {
            XCTAssertNil(ResponsesBeforeActiveDiagnostics.message(type: event.rawValue, enabled: false))
            XCTAssertEqual(ResponsesBeforeActiveDiagnostics.message(type: event.rawValue, enabled: true),
                           "OROT_PROVIDER_DIAGNOSTIC provider=openai stage=steering_before_active event=\(event.rawValue)")
        }
        XCTAssertEqual(ResponsesBeforeActiveDiagnostics.message(type: "private-ID-URL-message", enabled: true),
                       "OROT_PROVIDER_DIAGNOSTIC provider=openai stage=steering_before_active event=other")
    }

    func testBeforeActiveControlCandidatesStillReject() throws {
        for type in ["response.keep_alive", "session.created", "ping", "response.in_progress"] {
            var state = ResponsesSteeringState()
            let data = try JSONSerialization.data(withJSONObject: ["type": type])
            XCTAssertThrowsError(try state.consume(data)) { error in
                XCTAssertEqual(error as? ChatGPTResponsesError, .malformedEvent)
            }
        }
    }

    func testUnknownWireContentIsNotLoggedAndDisabledDiagnosticsAreSilent() {
        let object: [String: Any] = ["error": ["code": "private-code", "param": "private-param", "message": "private-message"]]
        XCTAssertNil(ResponsesSteeringDiagnostics.errorMessage(object, enabled: false))
        XCTAssertEqual(ResponsesSteeringDiagnostics.errorMessage(object, enabled: true),
                       "OROT_PROVIDER_DIAGNOSTIC provider=openai stage=steering_error code=other parameter=other")
    }

    func testAllowlistedValuesAndPreActiveErrorsPreserveMalformedRejection() throws {
        let object: [String: Any] = ["type": "error", "error": ["code": "invalid_request_error", "param": "tools", "message": "not logged"]]
        XCTAssertEqual(ResponsesSteeringDiagnostics.errorMessage(object, enabled: true),
                       "OROT_PROVIDER_DIAGNOSTIC provider=openai stage=steering_error code=invalid_request_error parameter=tools")
        for type in ["error", "response.failed", "unknown-private-type"] {
            var state = ResponsesSteeringState()
            var event = object
            event["type"] = type
            let data = try JSONSerialization.data(withJSONObject: event)
            XCTAssertThrowsError(try state.consume(data)) { error in
                XCTAssertEqual(error as? ChatGPTResponsesError, .malformedEvent)
            }
        }
    }
}
