import Foundation
@testable import OpenAIProvider
import XCTest

final class LoopbackCallbackServerTests: XCTestCase {
    func testListenerDeliversTheCallbackAndStopsAfterOneRequest() async throws {
        let server = LoopbackCallbackServer()
        let redirect = try await server.start()
        let callbackWaiter = Task { try await server.waitForCallback() }
        var components = try XCTUnwrap(URLComponents(url: redirect, resolvingAgainstBaseURL: false))
        components.queryItems = [
            URLQueryItem(name: "code", value: "fixture-code"),
            URLQueryItem(name: "state", value: "fixture-state"),
        ]
        let callbackURL = try XCTUnwrap(components.url)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 3
        configuration.timeoutIntervalForResource = 3

        do {
            let (_, response) = try await URLSession(configuration: configuration).data(from: callbackURL)
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
            let received = try await callbackWaiter.value
            XCTAssertEqual(received.host, "127.0.0.1")
            XCTAssertEqual(received.path, ChatGPTOAuthConstants.callbackPath)
            XCTAssertEqual(URLComponents(url: received, resolvingAgainstBaseURL: false)?.queryItems, components.queryItems)
        } catch {
            server.stop()
            throw error
        }
        server.stop()
    }

    func testStoppingListenerResumesCallbackWaiterWithCancellation() async throws {
        let server = LoopbackCallbackServer()
        _ = try await server.start()
        let callbackWaiter = Task { try await server.waitForCallback() }

        server.stop()

        do {
            _ = try await callbackWaiter.value
            XCTFail("Stopping the listener must end a pending callback wait.")
        } catch is CancellationError {
            // Explicit cancellation is the coordinator's recovery path for user cancellation.
        }
    }
}
