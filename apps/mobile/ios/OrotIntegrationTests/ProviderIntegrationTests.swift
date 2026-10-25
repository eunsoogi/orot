import Foundation
@testable import Orot
import XCTest

final class ProviderIntegrationTests: OrotFailFastTestCase {
    func testSyntheticCatalogStreamLimitAndCancellationUseProviderBridge() async throws {
        try await verify("openai-provider", assertions: "catalog-stream-rate-limit-cancellation")
    }

    func testSyntheticToolDefinitionAndLocalResultRoundTripUseProviderBridge() async throws {
        try await verify("openai-tools", assertions: "definitions-stream-tool-result-hosted-rejection")
    }

    private func verify(_ operation: String, assertions: String) async throws {
        // The original probe uses the native Simulator transport fixture. No real account or network access is inferred.
        let result = try await TestOperationBroker.shared.request(operation)
        XCTAssertEqual(result["platform"] as? String, "ios")
        XCTAssertEqual(result["runtime"] as? String, "Hermes")
        XCTAssertEqual(result["synthetic"] as? Bool, true)
        XCTAssertEqual(result["realAccount"] as? String, "unverified")
        XCTAssertEqual(result["assertions"] as? String, assertions)
        let attachment = try XCTAttachment(data: JSONSerialization.data(withJSONObject: result), uniformTypeIdentifier: "public.json")
        attachment.name = operation + "-provider-bridge"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
