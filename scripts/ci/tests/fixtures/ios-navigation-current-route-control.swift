import Foundation

@main
struct RouteObservationTest {
    static func report(keys: [String], name: String, stack: String = "stack-1", observer: String = "observer-1", window: String = "window-1", scene: String = "scene-1", events: [[String: Any]] = []) -> [String: Any] {
        let state: [String: Any] = ["logicalKeys": keys, "currentRouteKey": keys.last!, "currentRouteName": name, "ready": true, "nativeKeys": keys]
        let read: [String: Any] = ["status": "single", "stackID": stack, "state": state]
        let start = name == "conversation" ? 100.0 : 130.0
        return ["routeState": ["status": "consistent", "before": read, "after": read, "startedAtMs": start, "endedAtMs": start + 10], "atMs": start + 5, "observerID": observer, "windowGeometry": ["dockControls": ["windowID": window, "sceneID": scene]], "lifecycle": events]
    }

    static func main() {
        let baseline = NavigationCurrentRouteObservation.sample(report(keys: ["home", "conversation"], name: "conversation"))!
        let event: [String: Any] = ["event": "transition-end", "stackID": "stack-1", "routeKey": "source", "closing": false, "receivedAtMs": 120.0]
        func ready(_ r: [String: Any]) -> Bool {
            NavigationCurrentRouteObservation.isSourceReady(r, baseline: baseline, tappedAtMs: 115)
        }
        func source(_ events: [[String: Any]]) -> [String: Any] {
            report(keys: ["home", "conversation", "source"], name: "source-detail", events: events)
        }
        precondition(ready(source([event])))
        precondition(ready(source(Array(repeating: ["event": "other"], count: 100) + [event])))
        precondition(!ready(source([])))
        for change: (String, Any) in [("stackID", "stack-2"), ("routeKey", "old"), ("closing", true), ("receivedAtMs", 114.0)] {
            var e = event; e[change.0] = change.1; precondition(!ready(source([e])))
        }
        for r in [report(keys: ["home", "conversation", "source"], name: "source-detail", stack: "stack-2", events: [event]), report(keys: ["home", "conversation", "source"], name: "source-detail", observer: "other", events: [event]), report(keys: ["home", "conversation", "source"], name: "source-detail", window: "other", events: [event]), report(keys: ["home", "conversation", "source"], name: "source-detail", scene: "other", events: [event]), report(keys: ["home", "conversation"], name: "source-detail", events: [event])] {
            precondition(!ready(r))
        }
        var invalid = source([event]); var route = invalid["routeState"] as! [String: Any]
        route["status"] = "ambiguous"; invalid["routeState"] = route; precondition(!ready(invalid))
        invalid = source([event]); route = invalid["routeState"] as! [String: Any]
        var after = route["after"] as! [String: Any]; var state = after["state"] as! [String: Any]
        state["nativeKeys"] = ["home"]; after["state"] = state; route["after"] = after; invalid["routeState"] = route; precondition(!ready(invalid))
        invalid = source([event]); invalid["atMs"] = 200.0; precondition(!ready(invalid))
        print("current route correlation checks passed")
    }
}
