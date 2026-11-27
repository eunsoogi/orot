import Foundation
@testable import Orot
import XCTest

final class OpenAIProviderPhotoTerminalDeliveryTests: XCTestCase {
    @MainActor
    func testPhotoStopAfterReservationSuppressesQueuedPackets() async throws {
        let registry = OpenAIProviderRequestRegistry()
        var events = [String]()
        let slot = try accepted(registry, photo: true) { id, packet in
            events.append("\(id):\(packet["type"] as? String ?? "")")
        }

        slot.event(["type": "text_delta", "text": "synthetic fragment"])
        registry.finish(slot, .completed(.init(text: "synthetic answer")))
        XCTAssertFalse(registry.isActive(slot), "Completion is reserved, not yet on the main queue sink.")
        _ = registry.cancel(requestID: slot.id)
        await drain()
        XCTAssertTrue(events.isEmpty)
    }

    @MainActor
    func testRetiredTicketCannotEmitIntoIdenticallyNamedSuccessor() async throws {
        let registry = OpenAIProviderRequestRegistry()
        let first = try accepted(registry, photo: true) { _, _ in
            XCTFail("A retired ticket emitted after replacement.")
        }
        _ = registry.cancel(requestID: first.id)
        var texts = [String]()
        let successor = try accepted(registry, photo: true) { _, packet in
            texts.append(packet["text"] as? String ?? "")
        }
        registry.finish(first, .completed(.init(text: "stale answer")))
        registry.finish(successor, .completed(.init(text: "current answer")))
        await drain()
        XCTAssertEqual(texts, ["current answer"])
    }

    @MainActor
    func testTypedPhotoCompletionIsOrderedAndCannotBeSubstitutedByAPacketTag() async throws {
        let registry = OpenAIProviderRequestRegistry()
        var events = [String]()
        var contents = [String]()
        let slot = try accepted(registry, photo: true) { _, packet in
            events.append(packet["type"] as? String ?? "")
            contents.append(packet["text"] as? String ?? "")
        }

        let mutable = NSMutableDictionary(dictionary: ["type": "text_delta", "text": "synthetic fragment"])
        slot.event(mutable)
        mutable["type"] = "completed"
        slot.event(["type": "completed", "text": "not a typed result"])
        registry.finish(slot, .completed(.init(text: "synthetic answer")))
        registry.finish(slot, .failed(TestError.failed))
        await drain()
        XCTAssertEqual(events, ["text_delta", "completed"])
        XCTAssertEqual(contents, ["synthetic fragment", "synthetic answer"])
    }

    @MainActor
    func testOrdinaryResponsePreservesReservedTerminalAndExistingPayload() async throws {
        let registry = OpenAIProviderRequestRegistry()
        var packets = [NSDictionary]()
        let slot = try accepted(registry, photo: false) { _, packet in
            packets.append(packet)
        }
        slot.event(["type": "text_delta", "text": "synthetic fragment"])
        registry.finish(slot, .completed(.init(
            text: "synthetic answer",
            toolCalls: [.init(id: "tool-a", name: "fixture", argumentsJSON: "{}")],
            continuationItems: ["fixture-item"],
        )))
        _ = registry.cancel(requestID: slot.id)
        await drain()
        XCTAssertEqual(packets.compactMap { $0["type"] as? String }, ["text_delta", "completed"])
        let terminal = try XCTUnwrap(packets.last)
        XCTAssertEqual(terminal["text"] as? String, "synthetic answer")
        XCTAssertEqual(terminal["toolCalls"] as? [[String: String]], [
            ["id": "tool-a", "name": "fixture", "arguments": "{}"],
        ])
        XCTAssertEqual(terminal["continuationItems"] as? [String], ["fixture-item"])
    }

    @MainActor
    func testSignOutBetweenReservationAndEmissionRejectsTypedPhotoTerminal() async throws {
        let registry = OpenAIProviderRequestRegistry()
        let slot = try accepted(registry, photo: true) { _, _ in
            XCTFail("A revoked account emitted a queued packet.")
        }
        registry.finish(slot, .completed(.init(text: "retired account")))
        XCTAssertEqual(registry.beginSignOut(for: slot.issuedClientID)?.first?.id, slot.id)
        registry.finishSignOut(for: slot.issuedClientID)
        var outcomes = [String]()
        let successor = try accepted(registry, photo: true) { _, packet in
            outcomes.append(packet["type"] as? String ?? "")
        }
        registry.finish(successor, .failed(TestError.failed))
        await drain()
        XCTAssertEqual(outcomes, ["failed"])
    }

    private func accepted(
        _ registry: OpenAIProviderRequestRegistry,
        photo: Bool,
        emit: @escaping (String, NSDictionary) -> Void,
    ) throws -> OpenAIProviderRequestRegistry.Slot {
        switch registry.register("photo-reply:44444444444444444444444444444444", issuedClientID: "synthetic", photo: photo, emit: emit) {
        case let .accepted(slot): slot
        case .duplicate, .signingOut: throw TestError.failed
        }
    }

    /// Drain after the same main-queue deliveries used by the app registry, rather than mocking lifecycle order.
    @MainActor
    private func drain() async {
        await withCheckedContinuation { continuation in
            DispatchQueue.main.async {
                continuation.resume()
            }
        }
    }

    private enum TestError: Error {
        case failed
    }
}
