// Settings on the phone: the companies and their addresses, notifications for
// this device, what the AI has been doing, and signing out.
import { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, Switch, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import * as Device from "expo-device";
import { useSession } from "@/lib/session";
import { serverUrl } from "@/lib/api";
import { currentToken, disablePush, enablePush, pushPossible } from "@/lib/push";
import { space, useTheme } from "@/lib/theme";
import { Body, Button, Card, Loading, Notice, Pill, Row, Rows, Title } from "@/ui/kit";

export default function SettingsScreen() {
  const t = useTheme();
  const { me, refresh, signOut } = useSession();
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushNote, setPushNote] = useState("");

  useEffect(() => { currentToken().then(setPushToken); }, []);
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  async function togglePush(on: boolean) {
    setPushBusy(true);
    setPushNote("");
    try {
      if (on) {
        const out = await enablePush(Device.deviceName || "This phone");
        setPushToken(out.token ?? null);
        if (out.state !== "on") setPushNote(out.reason ?? "Notifications are not available on this device.");
      } else {
        await disablePush(pushToken);
        setPushToken(null);
      }
    } finally {
      setPushBusy(false);
    }
  }

  if (!me) return <Loading />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
        <View style={{ padding: space.lg, paddingBottom: space.sm }}>
          <Title>Settings</Title>
        </View>
        <View style={{ paddingHorizontal: space.lg, gap: space.lg }}>
          <Rows>
            {me.companies.map((c, i) => (
              <Row
                key={c.id}
                first={i === 0}
                last={i === me.companies.length - 1}
                tint={c.color}
                title={c.name}
                subtitle={`${c.domain} · ${c.addresses.length} ${c.addresses.length === 1 ? "address" : "addresses"}`}
                onPress={() => router.push({ pathname: "/company/[cid]", params: { cid: c.id } })}
              />
            ))}
          </Rows>

          <Card title="Notifications on this phone" subtitle="A banner the moment mail arrives at any of these companies.">
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
              <Body size={14.5} style={{ flex: 1 }}>{pushToken ? "On for this phone" : "Off"}</Body>
              <Switch value={!!pushToken} onValueChange={togglePush} disabled={pushBusy || !pushPossible()} />
            </View>
            {!pushPossible() ? (
              <Notice>Notifications need a development build of the app — Expo Go cannot receive them, and on iPhone they need an Apple developer account (mobile/README.md).</Notice>
            ) : null}
            {pushNote ? <Notice tone="warn">{pushNote}</Notice> : null}
          </Card>

          <Rows>
            <Row first title="AI activity" subtitle="What the AI drafted, sent or left alone" onPress={() => router.push("/activity")} />
            <Row title="Signed-in devices" subtitle="Phones and computers signed in to this account" onPress={() => router.push("/devices")} />
            <Row last title="Server" subtitle={serverUrl()} />
          </Rows>

          <Card title={me.owner.email} subtitle={me.owner.name || "Signed in on this device"}>
            <Button
              title="Sign out"
              variant="danger"
              onPress={() => Alert.alert("Sign out?", "This device will need the password again.", [
                { text: "Cancel", style: "cancel" },
                { text: "Sign out", style: "destructive", onPress: () => { disablePush(pushToken); signOut(); } },
              ])}
            />
          </Card>

          {me.setupMissing.length ? <Notice tone="warn">The server still needs {me.setupMissing.join(", ")}.</Notice> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/** Shown beside an address when its AI is on. */
export function AiPill({ mode }: { mode: string }) {
  if (mode === "off") return null;
  return <Pill tone="ai">{mode === "send" ? "AI sends" : "AI drafts"}</Pill>;
}
