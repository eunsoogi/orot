import Foundation
@testable import OpenAIProvider
import XCTest

final class ChatGPTModelCatalogTests: XCTestCase {
    func testListsOnlyVisibleModelsUsingTheSelectedAccountToken() async throws {
        let transport = StubOAuthHTTPTransport { request in
            guard request.url?.absoluteString == "https://api.openai.com/v1/models" else {
                return StubOAuthResponse(statusCode: 404, body: Data())
            }
            return StubOAuthResponse(
                statusCode: 200,
                body: Data(#"{"models":[{"slug":"gpt-visible","display_name":"Visible model","visibility":"list"},{"slug":"gpt-hidden","display_name":"Hidden model","visibility":"private"}]}"#.utf8),
            )
        }
        let store = InMemoryChatGPTCredentialStore()
        try store.saveAccount(syntheticAccount(expiresAt: Date().addingTimeInterval(3600)))
        let client = ChatGPTOAuthClient(transport: transport, credentialStore: store)

        let models = try await client.listModels(for: accountAccess())
        XCTAssertEqual(models, [ListedChatGPTModel(slug: "gpt-visible", displayName: "Visible model")])
        let requests = await transport.recordedRequests(path: "/v1/models")
        XCTAssertEqual(requests.count, 1)
        XCTAssertEqual(requests.first?.value(forHTTPHeaderField: "Authorization"), "Bearer fixture-access-token")
    }

    func testCatalogRejectsIdentityMismatchAndMissingPlanScope() async throws {
        let transport = StubOAuthHTTPTransport { _ in
            StubOAuthResponse(statusCode: 200, body: Data(#"{"models":[]}"#.utf8))
        }
        let store = InMemoryChatGPTCredentialStore()
        try store.saveAccount(syntheticAccount(expiresAt: Date().addingTimeInterval(3600)))
        let client = ChatGPTOAuthClient(transport: transport, credentialStore: store)

        do {
            _ = try await client.listModels(for: accountAccess(subject: "different-subject"))
            XCTFail("The selected identity must match the stored credentials.")
        } catch {
            XCTAssertEqual(error as? ChatGPTOAuthError, .accountIdentityMismatch)
        }

        let noPlanStore = InMemoryChatGPTCredentialStore()
        try noPlanStore.saveAccount(syntheticAccount(
            expiresAt: Date().addingTimeInterval(3600),
            scopes: ["openid"],
        ))
        let noPlanClient = ChatGPTOAuthClient(transport: transport, credentialStore: noPlanStore)
        do {
            _ = try await noPlanClient.listModels(forIssuedClientID: "oaiapp_fixture_client")
            XCTFail("The model catalog requires the direct plan scope.")
        } catch {
            XCTAssertEqual(error as? ChatGPTOAuthError, .planPermissionMissing)
        }
        let requests = await transport.recordedRequests(path: "/v1/models")
        XCTAssertTrue(requests.isEmpty)
    }

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

    func testCatalogHTTPFailurePreservesUsageDiagnostics() async throws {
        let transport = StubOAuthHTTPTransport { _ in
            StubOAuthResponse(
                statusCode: 429,
                body: Data(#"{"error":{"code":"subscription_sharing_usage_limit_exceeded","param":"model"}}"#.utf8),
                requestID: "req_catalog_limit",
            )
        }
        let store = InMemoryChatGPTCredentialStore()
        try store.saveAccount(syntheticAccount(expiresAt: Date().addingTimeInterval(3600)))
        let client = ChatGPTOAuthClient(transport: transport, credentialStore: store)

        do {
            _ = try await client.listModels(forIssuedClientID: "oaiapp_fixture_client")
            XCTFail("The catalog must preserve a plan usage-limit response.")
        } catch let ChatGPTOAuthError.modelCatalogHTTPFailure(diagnostics) {
            XCTAssertEqual(diagnostics.httpStatusCode, 429)
            XCTAssertEqual(diagnostics.bodyShape, "error_object")
            XCTAssertEqual(diagnostics.code, "subscription_sharing_usage_limit_exceeded")
            XCTAssertEqual(diagnostics.parameter, "model")
            XCTAssertEqual(diagnostics.requestID, "req_catalog_limit")
        }
    }
}
