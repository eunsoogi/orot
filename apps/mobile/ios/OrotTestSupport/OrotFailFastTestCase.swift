import Darwin
import Foundation
import XCTest

private final class OrotTestInvocationState: @unchecked Sendable {
    static let shared = OrotTestInvocationState()
    private let lock = NSLock()

    private init() {}

    private func marker() throws -> URL {
        guard let raw = ProcessInfo.processInfo.environment["OROT_IOS_TEST_INVOCATION"], UUID(uuidString: raw) != nil else {
            throw NSError(domain: "OrotTestInvocation", code: 1, userInfo: [NSLocalizedDescriptionKey: "Run native tests through run-ios-tests.mjs with a fresh invocation UUID"])
        }
        let root = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("OrotTestInvocation", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root.appendingPathComponent(raw + ".txt")
    }

    /// The marker survives a runner crash. Only identifiers are stored; failure details and health data stay out.
    func enter(_ name: String) throws {
        try lock.withLock {
            let file = try marker()
            if FileManager.default.fileExists(atPath: file.path) {
                let previous = try String(contentsOf: file, encoding: .utf8)
                throw XCTSkip("Not run after failed or interrupted case \(previous)")
            }
            try name.write(to: file, atomically: true, encoding: .utf8)
            print("OROT_TEST_CASE_ENTER \(name)")
        }
        try fixtureBoundary("prepare", name: name)
    }

    /// The iOS runner cannot invoke macOS simctl. It waits for the same host preparation while retaining this runner process.
    /// One loopback connection binds each UUID callback to its host. Host exit causes EOF, not an unbounded file wait.
    private func fixtureBoundary(_ stage: String, name: String, passed: Bool? = nil) throws {
        guard let session = ProcessInfo.processInfo.environment["OROT_IOS_FIXTURE_SESSION"] else { return }
        guard UUID(uuidString: session) != nil,
              let rawPort = ProcessInfo.processInfo.environment["OROT_IOS_FIXTURE_PORT"],
              let port = UInt16(rawPort), port > 0 else { throw NSError(domain: "OrotFixtureSession", code: 1) }
        let connection = socket(AF_INET, SOCK_STREAM, 0)
        guard connection >= 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        defer { close(connection) }
        var noSignal: Int32 = 1
        guard setsockopt(connection, SOL_SOCKET, SO_NOSIGPIPE, &noSignal, socklen_t(MemoryLayout<Int32>.size)) == 0 else {
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
        }
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = port.bigEndian
        address.sin_addr.s_addr = inet_addr("127.0.0.1")
        let connected = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                connect(connection, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard connected == 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        let token = UUID().uuidString
        var request: [String: Any] = ["session": session, "token": token, "name": name, "stage": stage]
        if let passed {
            request["passed"] = passed
        }
        var data = try JSONSerialization.data(withJSONObject: request)
        data.append(0x0A)
        try data.withUnsafeBytes { bytes in
            var offset = 0
            while offset < bytes.count {
                let sent = send(connection, bytes.baseAddress!.advanced(by: offset), bytes.count - offset, 0)
                guard sent > 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
                offset += sent
            }
        }
        var response = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while true {
            let count = recv(connection, &buffer, buffer.count, 0)
            guard count >= 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
            if count == 0 {
                break
            }
            response.append(contentsOf: buffer.prefix(count))
            guard response.count <= 65536 else { throw NSError(domain: "OrotFixtureSession", code: 3) }
        }
        let value = try JSONSerialization.jsonObject(with: response) as? [String: Any]
        guard value?["session"] as? String == session, value?["token"] as? String == token,
              value?["ok"] as? Bool == true
        else {
            throw NSError(domain: "OrotFixtureSession", code: 2, userInfo: [NSLocalizedDescriptionKey: value?["error"] as? String ?? "Invalid host fixture response"])
        }
    }

    /// Finish inside the final teardown while XCTest can still record thrown errors; observers run after stop.
    /// Failure/skip counts describe the active run without assuming hasSucceeded before XCTest stops it.
    func finish(_ testCase: XCTestCase) throws {
        try lock.withLock {
            let file = try marker()
            guard try String(contentsOf: file, encoding: .utf8) == testCase.name else { return }
            let passed = testCase.testRun?.totalFailureCount == 0 && testCase.testRun?.skipCount == 0
            try fixtureBoundary("complete", name: testCase.name, passed: passed)
            guard passed else { return }
            try FileManager.default.removeItem(at: file)
            print("OROT_TEST_CASE_CLEARED \(testCase.name)")
        }
    }
}

/// Compiled into test targets only. Each xcodebuild invocation owns a fresh namespace in its runner sandbox.
/// This cannot intercept bootstrap failures before setup, or coordinate different test-target sandboxes.
class OrotFailFastTestCase: XCTestCase {
    /// XCTest still invokes nonthrowing setup after a skip; subclasses must keep it limited to local flags.
    override final func setUpWithError() throws {
        try super.setUpWithError()
        try OrotTestInvocationState.shared.enter(name)
    }

    /// XCTest runs async teardown after registered blocks and both synchronous teardown hooks.
    override final func tearDown() async throws {
        try await super.tearDown()
        try OrotTestInvocationState.shared.finish(self)
    }
}
