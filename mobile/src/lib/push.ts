// Notifications when mail arrives. The phone asks Expo for a push token and
// hands it to the dashboard (server/push.ts), which sends through Expo when
// Stalwart reports a delivery.
//
// Remote notifications need a development build: Expo Go has not carried them
// since SDK 53, and on iOS the APNs key behind them comes from a paid Apple
// developer account. Everything here gives up quietly when that is missing, so
// the app runs the same in Expo Go — only without notifications.
import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { AndroidImportance } from "expo-notifications";
import { del, post } from "./api";

/** A notification arriving while the app is open still shows, without a sound. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export type PushState = "off" | "on" | "denied" | "unsupported";

const projectId = () =>
  (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId
  ?? (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;

/** Expo Go carries no remote notifications, and a simulator has none to carry. */
export const pushPossible = () => Device.isDevice && Constants.appOwnership !== "expo" && !!projectId();

/** Asks for permission, gets this phone's token, and tells the server. */
export async function enablePush(label: string): Promise<{ state: PushState; token?: string; reason?: string }> {
  if (!pushPossible()) {
    return {
      state: "unsupported",
      reason: !Device.isDevice ? "A simulator cannot receive notifications."
        : Constants.appOwnership === "expo" ? "Expo Go cannot receive them; a development build can."
        : "This build has no Expo project id, so Expo cannot address it.",
    };
  }
  // Android wants the channel before it will give out a token.
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("mail", {
      name: "New mail",
      importance: AndroidImportance.DEFAULT,
      lightColor: "#12A594",
    });
  }
  const existing = await Notifications.getPermissionsAsync();
  const granted = existing.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return { state: "denied", reason: "Notifications are turned off for Xooteq Mail in this phone's settings." };

  try {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId: projectId()! })).data;
    await post("/api/push/register", { token, platform: Platform.OS, label });
    return { state: "on", token };
  } catch (e) {
    return { state: "unsupported", reason: (e as Error).message };
  }
}

/** Stops the notifications for this phone, here and on the server. */
export async function disablePush(token: string | null): Promise<void> {
  if (!token) return;
  await del(`/api/push/register?token=${encodeURIComponent(token)}`).catch(() => {});
}

/** The token this phone already has, without asking for anything. */
export async function currentToken(): Promise<string | null> {
  if (!pushPossible()) return null;
  try {
    const { granted } = await Notifications.getPermissionsAsync();
    if (!granted) return null;
    return (await Notifications.getExpoPushTokenAsync({ projectId: projectId()! })).data;
  } catch {
    return null;
  }
}

export const clearBadge = () => Notifications.setBadgeCountAsync(0).catch(() => false);

/** What the server put in the notification: which company's mail, and where. */
export type MailPush = { kind?: string; companyId?: string; address?: string };

export function mailPushOf(notification: Notifications.Notification | null | undefined): MailPush | null {
  const data = notification?.request?.content?.data as MailPush | undefined;
  return data?.kind === "mail" ? data : null;
}

/** Runs fn when a notification is tapped, and for the one that opened the app. */
export function onNotificationTap(fn: (data: MailPush) => void): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = mailPushOf(response.notification);
    if (data) fn(data);
  });
  void Notifications.getLastNotificationResponseAsync().then((response) => {
    const data = mailPushOf(response?.notification);
    if (data) fn(data);
  });
  return () => sub.remove();
}

/** Runs fn whenever one arrives while the app is open, to refresh what is shown. */
export function onNotificationArrived(fn: (data: MailPush) => void): () => void {
  const sub = Notifications.addNotificationReceivedListener((notification) => {
    const data = mailPushOf(notification);
    if (data) fn(data);
  });
  return () => sub.remove();
}
