// One sending app's message log: what went out, what bounced, what is held,
// and what the receiving server said about each one.
import { useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { get, post } from "@/lib/api";
import { useLoad } from "@/lib/use-load";
import type { SendMessage, SendPage } from "@/lib/types";
import { relative } from "@/lib/format";
import { radius, space, useTheme } from "@/lib/theme";
import { Body, Button, Loading, Notice, Pill, Segmented } from "@/ui/kit";

type Scope = "outgoing" | "incoming" | "held";

const TONE: Record<string, "ok" | "warn" | "error" | "neutral"> = {
  Sent: "ok", SoftFail: "warn", HardFail: "error", Held: "warn", Bounced: "error", Pending: "neutral",
};

export default function SendingApp() {
  const t = useTheme();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const [scope, setScope] = useState<Scope>("outgoing");
  const { data: page, error, busy, refresh } = useLoad(
    () => get<SendPage<{ messages: SendMessage[] }>>(`/api/sending/apps/${encodeURIComponent(String(id))}/messages?scope=${scope}`),
    `${id}:${scope}`,
  );

  const retry = async (m: SendMessage) => {
    try {
      await post(`/api/sending/apps/${encodeURIComponent(String(id))}/messages/${m.id}/retry`);
      Alert.alert("Sending again", `${m.to} is back in the queue.`);
      refresh();
    } catch (e) {
      Alert.alert("That did not work", (e as Error).message);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 48 }}
      refreshControl={<RefreshControl refreshing={busy} onRefresh={refresh} tintColor={t.ink3} />}
    >
      <Stack.Screen options={{ title: String(name ?? "App") }} />
      <Segmented
        value={scope}
        onChange={setScope}
        options={[{ value: "outgoing" as Scope, label: "Sent" }, { value: "incoming" as Scope, label: "Received" }, { value: "held" as Scope, label: "Held" }]}
      />
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!page && !error ? <Loading /> : null}
      {page?.messages.length === 0 ? <Body dim size={13.5}>Nothing here.</Body> : null}

      {(page?.messages ?? []).map((m) => (
        <Pressable
          key={m.id}
          onPress={() => Alert.alert(m.subject || "(no subject)", `To ${m.to}\nFrom ${m.from}\n${m.status}${m.tag ? ` · ${m.tag}` : ""}`, [
            ...(m.status === "HardFail" || m.status === "SoftFail" || m.held ? [{ text: "Send again", onPress: () => retry(m) }] : []),
            { text: "Close", style: "cancel" as const },
          ])}
          style={{ backgroundColor: t.panel, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: t.line, padding: space.md, gap: 4 }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Body size={14} numberOfLines={1} style={{ flex: 1 }}>{m.to}</Body>
            <Pill tone={TONE[m.status] ?? "neutral"}>{m.status}</Pill>
          </View>
          <Body dim size={13} numberOfLines={1}>{m.subject || "(no subject)"}</Body>
          <Body dim size={11.5}>{m.timestamp ? relative(Date.parse(m.timestamp)) : ""}{m.tag ? ` · ${m.tag}` : ""}</Body>
        </Pressable>
      ))}

      {page && page.totalPages > 1 ? <Body dim size={12.5}>Showing the newest {page.messages.length} of {page.total}.</Body> : null}
      <Button title="Refresh" onPress={refresh} busy={busy} />
    </ScrollView>
  );
}
