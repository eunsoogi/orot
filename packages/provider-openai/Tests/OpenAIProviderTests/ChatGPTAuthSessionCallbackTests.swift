@testable import OpenAIProvider
import XCTest

final class ChatGPTAuthSessionCallbackTests: XCTestCase {
    func testAcceptsOnlyTheFixedSecretFreeAppReturnURL() throws {
        let valid = try XCTUnwrap(URL(string: "orot://oauth/complete"))
        XCTAssertTrue(ChatGPTOAuthConstants.isValidAppReturnURL(valid))

        let invalidValues = [
            "other://oauth/complete",
            "orot://other/complete",
            "orot://oauth/other",
            "orot://oauth/complete?code=secret",
            "orot://oauth/complete#fragment",
            "orot://user@oauth/complete",
            "orot://oauth:443/complete",
        ]
        for value in invalidValues {
            let url = try XCTUnwrap(URL(string: value), "Expected fixture URL to parse: \(value)")
            XCTAssertFalse(ChatGPTOAuthConstants.isValidAppReturnURL(url), value)
        }
    }
}
