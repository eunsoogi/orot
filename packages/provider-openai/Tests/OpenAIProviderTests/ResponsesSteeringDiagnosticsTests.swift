import Foundation
@testable import OpenAIProvider
import XCTest

final class ResponsesSteeringDiagnosticsTests: XCTestCase {
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
