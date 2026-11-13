@testable import Orot
import XCTest

/// Exercises the native guard decisions independently of UIKit timing or a particular simulator.
final class RotationGeometryGuardTests: XCTestCase {
    @MainActor
    func testDuplicateRequestsAndForeignPhasesAreRejected() {
        XCTAssertTrue(NavigationRotationProbe.allowsRequest(changed: false, count: 0))
        XCTAssertFalse(NavigationRotationProbe.allowsRequest(changed: false, count: 1))
        XCTAssertFalse(NavigationRotationProbe.allowsRequest(changed: true, count: 0))
        XCTAssertTrue(NavigationRotationProbe.matchesPhase(currentSession: "one", currentGeneration: 2, session: "one", generation: 2))
        XCTAssertFalse(NavigationRotationProbe.matchesPhase(currentSession: "one", currentGeneration: 2, session: "other", generation: 2))
        XCTAssertFalse(NavigationRotationProbe.matchesPhase(currentSession: "one", currentGeneration: 2, session: "one", generation: 1))
        let scene = NSObject(), window = NSObject(), other = NSObject()
        XCTAssertTrue(NavigationRotationProbe.matchesBinding(currentScene: scene, currentWindow: window, scene: scene, window: window))
        XCTAssertFalse(NavigationRotationProbe.matchesBinding(currentScene: scene, currentWindow: window, scene: other, window: window))
        XCTAssertFalse(NavigationRotationProbe.matchesBinding(currentScene: scene, currentWindow: window, scene: scene, window: other))
    }
}
