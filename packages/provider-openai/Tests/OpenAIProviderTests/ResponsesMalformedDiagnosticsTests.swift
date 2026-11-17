import Foundation
@testable import OpenAIProvider
import XCTest

final class ResponsesMalformedDiagnosticsTests: XCTestCase {
    func testDisabledDiagnosticsProduceNoMessageForEveryCategory() {
        for category in ResponsesMalformedDiagnostics.Category.allCases {
            XCTAssertNil(ResponsesMalformedDiagnostics.message(category, enabled: false))
        }
    }

    func testEnabledMessagesContainOnlyTheClosedCategoryAndFixedPrefix() {
        let prefix = "OROT_PROVIDER_DIAGNOSTIC provider=openai stage=parser_validation category="
        let categories = ResponsesMalformedDiagnostics.Category.allCases
        XCTAssertEqual(Set(categories.map(\.rawValue)).count, categories.count)
        for category in categories {
            XCTAssertNotNil(category.rawValue.range(of: "^[a-z_]+$", options: .regularExpression))
            XCTAssertEqual(ResponsesMalformedDiagnostics.message(category, enabled: true), prefix + category.rawValue)
            XCTAssertEqual(ResponsesMalformedDiagnostics.failure(category), .malformedEvent)
        }
    }
}
