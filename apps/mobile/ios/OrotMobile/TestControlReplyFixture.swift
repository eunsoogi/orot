#if OROT_TESTS
    import Foundation
    import React
    import UserNotifications

    extension OrotTestControl {
        /// Inject only the reserved synthetic tap through the production native inbox.
        @objc(enqueueSyntheticReply:resolver:rejecter:)
        func enqueueSyntheticReply(_ input: [String: Any], resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
            let requestID = "synthetic-native-reply-request"
            let sessionID = "synthetic-native-reply-session"
            guard UserDefaults.standard.string(forKey: "OROT_TEST_SCENARIO") == "assistant-reply-acceptance",
                  input["requestId"] as? String == requestID,
                  input["sessionId"] as? String == sessionID,
                  input["messageId"] as? String == requestID,
                  input["sessionVersion"] as? Int == 0
            else {
                reject("INVALID_FIXTURE", "The synthetic reply fixture is not authorized.", nil)
                return
            }
            let content = UNMutableNotificationContent()
            content.userInfo = ["requestId": requestID, "sessionId": sessionID, "messageId": requestID, "sessionVersion": 0]
            let request = UNNotificationRequest(identifier: ReplyNotificationService.prefix + requestID, content: content, trigger: nil)
            AppointmentReminderDelivery.shared.receive(request, actionIdentifier: UNNotificationDefaultActionIdentifier)
            guard AppointmentReminderDelivery.shared.consumeReplyTarget() == ["requestId": requestID, "sessionId": sessionID, "messageId": requestID, "sessionVersion": "0"] else {
                reject("INBOX_FAILURE", "The synthetic reply was not retained in the inbox.", nil)
                return
            }
            resolve(nil)
        }
    }
#endif
