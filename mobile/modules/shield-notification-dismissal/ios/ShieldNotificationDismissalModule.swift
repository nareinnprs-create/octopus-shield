import ExpoModulesCore

public class ShieldNotificationDismissalModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ShieldNotificationDismissal")
    AsyncFunction("remember") { (payload: [String: Any]) in
      if let identity = PushDismissalIdentity(payload) { PushDismissalLedger.shared.remember(identity) }
    }
    AsyncFunction("wasDismissed") { (payload: [String: Any]) -> Bool in
      guard let identity = PushDismissalIdentity(payload) else { return false }
      return PushDismissalLedger.shared.contains(identity)
    }
  }
}
