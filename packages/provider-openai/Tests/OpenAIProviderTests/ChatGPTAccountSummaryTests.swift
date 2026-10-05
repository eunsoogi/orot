import Foundation
@testable import OpenAIProvider
import XCTest

final class ChatGPTAccountSummaryTests: XCTestCase {
    func testListStoredAccountsReturnsOnlyCredentialFreeSummaries() throws {
        let store = InMemoryChatGPTCredentialStore()
        try store.saveAccount(Self.account(
            issuedClientID: "oaiapp_fixture-zeta",
            subject: "private-subject-zeta",
            signedIn: true,
        ))
        try store.saveAccount(Self.account(
            issuedClientID: "oaiapp_fixture-alpha",
            subject: "private-subject-alpha",
            signedIn: false,
        ))
        let client = ChatGPTOAuthClient(credentialStore: store)

        let summaries = try client.listStoredAccounts()

        XCTAssertEqual(summaries.map(\.issuedClientID), ["oaiapp_fixture-alpha", "oaiapp_fixture-zeta"])
        XCTAssertTrue(summaries[0].requiresSignIn)
        XCTAssertFalse(summaries[0].hasDirectPlanAccess)
        XCTAssertFalse(summaries[1].requiresSignIn)
        XCTAssertTrue(summaries[1].hasDirectPlanAccess)

        let encoded = try JSONEncoder().encode(summaries[1])
        let fields = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        XCTAssertEqual(Set(fields.keys), ["issuedClientID", "requiresSignIn", "hasDirectPlanAccess"])
        let serialized = try XCTUnwrap(String(data: encoded, encoding: .utf8))
        XCTAssertFalse(serialized.contains("private-subject-zeta"))
        XCTAssertFalse(serialized.contains("fixture-access-token"))
        XCTAssertFalse(serialized.contains("fixture-refresh-token"))
        XCTAssertFalse(serialized.contains("fixture-id-token"))
    }

    func testKeychainListingIsScopedToItsServiceAndSurfacesStoredAccounts() throws {
        let service = "com.orot.provider.openai.credentials.tests.\(UUID().uuidString)"
        let store = KeychainChatGPTCredentialStore(service: service)
        let first = Self.account(
            issuedClientID: "oaiapp_fixture-first",
            subject: "private-subject-first",
            signedIn: true,
        )
        let second = Self.account(
            issuedClientID: "oaiapp_fixture-second",
            subject: "private-subject-second",
            signedIn: false,
        )
        defer {
            try? store.removeAccount(issuedClientID: first.issuedClientID)
            try? store.removeAccount(issuedClientID: second.issuedClientID)
        }
        try store.saveAccount(first)
        try store.saveAccount(second)

        let listed = try store.listAccounts()

        XCTAssertEqual(listed.map(\.issuedClientID), [first.issuedClientID, second.issuedClientID])
        XCTAssertEqual(listed.map(\.subject), [first.subject, second.subject])
    }

    func testSummaryReportsExpiredWithoutRefreshAndMissingScopeStates() throws {
        let store = InMemoryChatGPTCredentialStore()
        let expiredID = "oaiapp_fixture-expired"
        let missingScopeID = "oaiapp_fixture-no-scope"
        try store.saveAccount(ChatGPTStoredAccount(
            issuedClientID: expiredID,
            hostIdentifier: "urn:uuid:0cc04a4c-0f3a-4f49-8bda-10675883a491",
            subject: "private-expired-subject",
            grantedScopes: ["openid", ChatGPTOAuthConstants.directPlanScope],
            expiresAt: Date(timeIntervalSince1970: 1),
            credentials: ChatGPTStoredCredentials(
                accessToken: "fixture-expired-access-token",
                refreshToken: nil,
                idToken: "fixture-expired-id-token",
                tokenType: "Bearer",
            ),
        ))
        try store.saveAccount(Self.account(
            issuedClientID: missingScopeID,
            subject: "private-no-scope-subject",
            signedIn: true,
            scopes: ["openid"],
        ))
        let summaries = try ChatGPTOAuthClient(credentialStore: store).listStoredAccounts()

        XCTAssertTrue(try XCTUnwrap(summaries.first { $0.issuedClientID == expiredID }).requiresSignIn)
        let missingScope = try XCTUnwrap(summaries.first { $0.issuedClientID == missingScopeID })
        XCTAssertFalse(missingScope.requiresSignIn)
        XCTAssertFalse(missingScope.hasDirectPlanAccess)
    }

    private static func account(
        issuedClientID: String,
        subject: String,
        signedIn: Bool,
        scopes: Set<String>? = nil,
    ) -> ChatGPTStoredAccount {
        ChatGPTStoredAccount(
            issuedClientID: issuedClientID,
            hostIdentifier: "urn:uuid:0cc04a4c-0f3a-4f49-8bda-10675883a491",
            subject: subject,
            grantedScopes: signedIn ? (scopes ?? ["openid", ChatGPTOAuthConstants.directPlanScope]) : [],
            expiresAt: signedIn ? Date(timeIntervalSince1970: 1_900_000_000) : nil,
            credentials: signedIn ? ChatGPTStoredCredentials(
                accessToken: "fixture-access-token",
                refreshToken: "fixture-refresh-token",
                idToken: "fixture-id-token",
                tokenType: "Bearer",
            ) : nil,
        )
    }
}
