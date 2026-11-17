import Foundation
@testable import OpenAIProvider
import XCTest

final class ResponsesRequestValidationDiagnosticsTests: XCTestCase {
    func testDiagnosticsAreOptInClosedCategoriesAndPreservePublicErrors() {
        for category in ResponsesRequestValidationDiagnostics.Category.allCases {
            XCTAssertNil(ResponsesRequestValidationDiagnostics.message(category, enabled: false))
            XCTAssertEqual(ResponsesRequestValidationDiagnostics.message(category, enabled: true),
                           "OROT_PROVIDER_DIAGNOSTIC provider=openai stage=request_validation category=\(category.rawValue)")
            XCTAssertNotNil(category.rawValue.range(of: "^[a-z_]+$", options: .regularExpression))
            XCTAssertEqual(ResponsesRequestValidationDiagnostics.failure(category), .invalidRequest)
        }
    }
}
