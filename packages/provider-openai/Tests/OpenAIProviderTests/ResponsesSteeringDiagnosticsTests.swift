import Foundation
@testable import OpenAIProvider
import XCTest

final class ResponsesSteeringDiagnosticsTests: XCTestCase {
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
