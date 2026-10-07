import Foundation
@testable import OpenAIProvider
import XCTest

final class LoopbackCallbackServerTests: XCTestCase {
    func testSuccessfulCallbackReturnsToAuthenticationSessionWithoutOAuthValues() async throws {
        let appReturnURL = ChatGPTOAuthConstants.appReturnURL
        let server = LoopbackCallbackServer(returnsToApp: true)
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
        let redirectDelegate = RedirectCapturingDelegate()
        let session = URLSession(configuration: configuration, delegate: redirectDelegate, delegateQueue: nil)

        do {
            let (body, response) = try await session.data(from: callbackURL)
            let http = try XCTUnwrap(response as? HTTPURLResponse)
            XCTAssertEqual(http.statusCode, 302)
            XCTAssertEqual(http.value(forHTTPHeaderField: "Location"), appReturnURL.absoluteString)
            XCTAssertEqual(http.value(forHTTPHeaderField: "Cache-Control"), "no-store")
            XCTAssertFalse(String(decoding: body, as: UTF8.self).contains("fixture-code"))
            XCTAssertNil(redirectDelegate.target?.url?.query)

            let received = try await callbackWaiter.value
            XCTAssertEqual(received.host, "127.0.0.1")
            XCTAssertEqual(received.path, ChatGPTOAuthConstants.callbackPath)
            XCTAssertEqual(URLComponents(url: received, resolvingAgainstBaseURL: false)?.queryItems, components.queryItems)
        } catch {
            server.stop()
            throw error
        }
        session.finishTasksAndInvalidate()
        server.stop()
    }

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
            let http = try XCTUnwrap(response as? HTTPURLResponse)
            XCTAssertEqual(http.statusCode, 200)
            // The cancellation probe needs a local page that cannot return the auth session to Orot.
            XCTAssertNil(http.value(forHTTPHeaderField: "Location"))
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

/// URLSession invokes the redirect delegate away from the test task, so protect its captured request.
private final class RedirectCapturingDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private let lock = NSLock()
    private var capturedTarget: URLRequest?

    var target: URLRequest? {
        lock.lock()
        defer { lock.unlock() }
        return capturedTarget
    }

    func urlSession(
        _: URLSession,
        task _: URLSessionTask,
        willPerformHTTPRedirection _: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void,
    ) {
        lock.lock()
        capturedTarget = request
        lock.unlock()
        completionHandler(nil)
    }
}
