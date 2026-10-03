import Foundation
import XCTest
@testable import OpenAIProvider

final class ChatGPTModelCatalogTests: XCTestCase {
    func testModelRequestCancellationIsNotConvertedToCatalogFailure() async throws {
        let gate = RequestGate()
        let transport = StubOAuthHTTPTransport { request in
            guard request.url?.path == "/v1/models" else {
                return StubOAuthResponse(statusCode: 404, body: Data())
            }
            await gate.wait()
            try Task.checkCancellation()
            return StubOAuthResponse(statusCode: 200, body: Data(#"{"models":[]}"#.utf8))
        }
        let store = InMemoryChatGPTCredentialStore()
        try store.saveAccount(syntheticAccount(expiresAt: Date().addingTimeInterval(3600)))
        let client = ChatGPTOAuthClient(transport: transport, credentialStore: store)
        let request = Task {
            try await client.listModels(forIssuedClientID: "oaiapp_fixture_client")
        }
        await transport.waitForRequest(path: "/v1/models")

        request.cancel()
        await gate.open()

        do {
            _ = try await request.value
            XCTFail("Cancelling a model request must remain a cancellation.")
        } catch is CancellationError {
            // Expected: cancellation stays distinguishable from provider failure.
        } catch {
            XCTFail("Expected cancellation, got \(error).")
        }
    }
}
