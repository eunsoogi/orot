import Foundation
@_spi(SelectedEncounterNative) import OpenAIProvider

/// Owned by the recording route on the same native actor as protection and
/// selected-account changes. An authoritative storage/Settings producer, not
/// a JS payload, supplies the current binding.
@MainActor
final class ProtectedPlanPageOwner {
    enum Denied: Error { case stale }

    struct Binding: Equatable, Sendable {
        struct Revision: Equatable, Sendable {
            let id: Data
            let revision: UInt64
        }

        struct Roles: Equatable, Sendable {
            let instruction: Data
            let transcript: Data
            let citations: Data
            let schema: Data
        }

        let operation: Data
        let source: Data
        let revisions: [Revision]
        let account: Data
        let subject: Data
        let model: Data
        let credentialEpoch: UUID
        let consentEpoch: UUID
        let protection: String
        let roles: Roles
    }

    final class Prepared {
        fileprivate let owner: UUID
        fileprivate let generation: UUID
        fileprivate let binding: Binding
        fileprivate init(owner: UUID, generation: UUID, binding: Binding) {
            self.owner = owner
            self.generation = generation
            self.binding = binding
        }
    }

    private let owner = UUID()
    private var generation = UUID()
    private var operation = Phase.idle
    private enum Phase {
        case idle
        case preparing
        case prepared(Prepared, PreparedEncounterResponse)
        case submitted(Prepared, PreparedEncounterResponse)
        case retired
    }

    private let current: () -> Binding?
    private let protection: () -> String?

    init(current: @escaping () -> Binding?, protection: @escaping () -> String?) {
        self.current = current
        self.protection = protection
    }

    private func matches(_ binding: Binding, generation: UUID) -> Bool {
        self.generation == generation && protection() == binding.protection && current() == binding
    }

    func prepare(_ binding: Binding, client: ChatGPTOAuthClient) async throws -> Prepared {
        let start = generation
        guard case .idle = operation, !binding.revisions.isEmpty,
              matches(binding, generation: start),
              let account = String(data: binding.account, encoding: .utf8),
              let subject = String(data: binding.subject, encoding: .utf8),
              let model = String(data: binding.model, encoding: .utf8),
              let instruction = String(data: binding.roles.instruction, encoding: .utf8),
              let transcript = String(data: binding.roles.transcript, encoding: .utf8),
              let citations = String(data: binding.roles.citations, encoding: .utf8),
              let schema = String(data: binding.roles.schema, encoding: .utf8)
        else { throw Denied.stale }
        operation = .preparing
        do {
            let suspended = try await client.prepareSelectedEncounterPage(
                .init(accountID: account, subject: subject, model: model, instruction: instruction,
                      transcript: transcript, citations: citations, schema: schema),
                admitted: { [weak self] in
                    await MainActor.run { self?.matches(binding, generation: start) == true }
                },
            )
            guard case .preparing = operation, matches(binding, generation: start), !Task.isCancelled else {
                suspended.cancel()
                throw Denied.stale
            }
            let ticket = Prepared(owner: owner, generation: start, binding: binding)
            operation = .prepared(ticket, suspended)
            return ticket
        } catch {
            retire()
            throw error
        }
    }

    /// The check and actual native resume happen in the same synchronous
    /// actor turn. Awaiting an implicit URLSession.bytes start is insufficient.
    func admitAndSubmit(_ ticket: Prepared, binding: Binding) -> Bool {
        guard ticket.owner == owner,
              case let .prepared(prepared, suspended) = operation,
              prepared === ticket
        else { return false }
        guard !Task.isCancelled, ticket.binding == binding,
              matches(binding, generation: ticket.generation)
        else {
            retire()
            return false
        }
        guard suspended.admitAndResume(admitted: { matches(binding, generation: ticket.generation) }) else {
            retire()
            return false
        }
        operation = .submitted(ticket, suspended)
        return true
    }

    func completedText(_ ticket: Prepared) async throws -> String {
        guard ticket.owner == owner, case let .submitted(submitted, response) = operation, submitted === ticket else { throw Denied.stale }
        do {
            let text = try await response.completedText()
            guard case let .submitted(finalOwner, _) = operation, finalOwner === ticket,
                  !Task.isCancelled, matches(ticket.binding, generation: ticket.generation)
            else { throw Denied.stale }
            operation = .retired
            return text
        } catch {
            retire()
            throw error
        }
    }

    func retire() {
        generation = UUID()
        let previous = operation
        operation = .retired
        switch previous {
        case let .prepared(_, suspended), let .submitted(_, suspended): suspended.cancel()
        default: break
        }
    }
}

#if os(iOS)
    import UIKit

    extension ProtectedPlanPageOwner {
        /// Uses the existing sticky protected-data witness. The recording owner
        /// must also retire its page on Stop, route removal, and consent revocation.
        convenience init(appDelegate: AppDelegate, current: @escaping () -> Binding?) {
            self.init(current: current, protection: { [weak appDelegate] in
                appDelegate?.currentEncounterProtectionGeneration(in: UIApplication.shared)
            })
        }
    }
#endif
