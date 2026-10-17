import Foundation
@testable import Orot
import XCTest

final class HealthIntegrationTests: OrotFailFastTestCase {
    func testAuthorizationScopesAndSyntheticSamplesStayExplicit() async throws {
        let summary = try await run("healthkit")
        for field in ["authorizationPlan=feature-scoped", "writeTypes=0", "sampleTypes=passed", "syntheticSteps=passed", "unrelatedSleep=passed", "emptyQuery=completed", "realSamples=unverified"] {
            XCTAssertTrue(summary.contains(field), summary)
        }
        XCTAssertNotNil(summary.range(of: "availability=(available|unavailable)", options: .regularExpression))
    }

    func testSyntheticSleepNormalizationAndAnchorResume() async throws {
        let summary = try await run("sleep-import")
        for field in ["stage=asleepUnspecified", "category=1", "interval=preserved", "anchorResume=passed", "anchoredNormalization=passed", "readAuthorization=notObservable", "source=synthetic", "realSamples=unverified"] {
            XCTAssertTrue(summary.contains(field), summary)
        }
        XCTAssertNotNil(summary.range(of: "availability=(available|unavailable)", options: .regularExpression))
        XCTAssertNotNil(summary.range(of: "sleepAuthorization=(completed|notRequested)", options: .regularExpression))
    }

    private func run(_ name: String) async throws -> String {
        // DEBUG supplies Simulator fixtures; these assertions cannot prove a physical device's sample access.
        let result = try await TestOperationBroker.shared.request(name)
        XCTAssertEqual(result["platform"] as? String, "ios")
        XCTAssertEqual(result["runtime"] as? String, "Hermes")
        XCTAssertEqual(result["synthetic"] as? Bool, true)
        let attachment = try XCTAttachment(data: JSONSerialization.data(withJSONObject: result), uniformTypeIdentifier: "public.json")
        attachment.name = "health-\(name)"
        attachment.lifetime = .keepAlways
        add(attachment)
        return try XCTUnwrap(result["summary"] as? String)
    }
}
