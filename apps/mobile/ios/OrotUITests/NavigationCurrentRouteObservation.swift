import Foundation

/// Validates the test-only live route state without reconstructing it from historical events.
enum NavigationCurrentRouteObservation {
    struct Sample {
        let stackID: String
        let routeKey: String
        let routeName: String
        let logicalKeys: [String]
        let observerID: String
        let windowID: String
        let sceneID: String
        let startedAtMs: Double
        let endedAtMs: Double
    }

    static func sample(_ report: [String: Any]) -> Sample? {
        guard let route = report["routeState"] as? [String: Any], route["status"] as? String == "consistent",
              let before = route["before"] as? [String: Any], let after = route["after"] as? [String: Any],
              before["status"] as? String == "single", after["status"] as? String == "single",
              let stackID = before["stackID"] as? String, !stackID.isEmpty, after["stackID"] as? String == stackID,
              let left = before["state"] as? [String: Any], let right = after["state"] as? [String: Any],
              let keys = left["logicalKeys"] as? [String], !keys.isEmpty, right["logicalKeys"] as? [String] == keys,
              let key = left["currentRouteKey"] as? String, !key.isEmpty, keys.last == key, right["currentRouteKey"] as? String == key,
              let name = left["currentRouteName"] as? String, !name.isEmpty, right["currentRouteName"] as? String == name,
              left["ready"] as? Bool == true, right["ready"] as? Bool == true,
              let native = left["nativeKeys"] as? [String], native == keys, right["nativeKeys"] as? [String] == native,
              let start = route["startedAtMs"] as? Double, let end = route["endedAtMs"] as? Double,
              start.isFinite, end.isFinite, start <= end,
              let nativeTime = report["atMs"] as? Double, nativeTime.isFinite,
              nativeTime >= start - 1, nativeTime <= end + 1,
              let observer = report["observerID"] as? String, !observer.isEmpty,
              let geometry = report["windowGeometry"] as? [String: Any], let dock = geometry["dockControls"] as? [String: Any],
              let window = dock["windowID"] as? String, !window.isEmpty,
              let scene = dock["sceneID"] as? String, !scene.isEmpty else { return nil }
        return Sample(stackID: stackID, routeKey: key, routeName: name, logicalKeys: keys, observerID: observer,
                      windowID: window, sceneID: scene, startedAtMs: start, endedAtMs: end)
    }

    static func isSourceReady(_ report: [String: Any], baseline: Sample, tappedAtMs: Double) -> Bool {
        guard let current = sample(report), current.stackID == baseline.stackID,
              current.observerID == baseline.observerID, current.windowID == baseline.windowID, current.sceneID == baseline.sceneID,
              current.routeName == "source-detail", current.routeKey != baseline.routeKey, !baseline.logicalKeys.contains(current.routeKey),
              let events = report["lifecycle"] as? [[String: Any]] else { return false }
        let sampledAt = report["atMs"] as? Double ?? 0
        return events.contains { $0["event"] as? String == "transition-end" && $0["stackID"] as? String == current.stackID &&
            $0["routeKey"] as? String == current.routeKey && $0["closing"] as? Bool == false &&
            ($0["receivedAtMs"] as? Double ?? 0) >= tappedAtMs && ($0["receivedAtMs"] as? Double ?? .infinity) <= sampledAt
        }
    }
}
