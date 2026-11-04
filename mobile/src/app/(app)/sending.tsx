// What the apps send through Postal: each app, what went out today, and how
// much of it bounced. Tapping one opens its message log.
import { useCallback } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { get } from "@/lib/api";
import { useLoad } from "@/lib/use-load";
import type { SendOverview } from "@/lib/types";
import { space, useTheme } from "@/lib/theme";
import { Body, Empty, Loading, Notice, Pill, Row, Rows, Title } from "@/ui/kit";

export default function SendingScreen() {
  const t = useTheme();
  const { data: o, error, busy, refresh } = useLoad(() => get<SendOverview>("/api/sending"));
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 48 }}
        refreshControl={<RefreshControl refreshing={busy} onRefresh={refresh} tintColor={t.ink3} />}
      >
        <View>
          <Title>Sending</Title>
          <Body dim size={13.5}>Sign-in codes, contact forms, anything your apps send through this server.</Body>
        </View>

        {error ? <Notice tone="error">{error}</Notice> : null}
        {!o && !error ? <Loading /> : null}

        {o?.servers.length === 0 ? <Empty title="No apps yet">Make one in the browser under Settings → Sending.</Empty> : null}

        {o && o.servers.length > 0 ? (
          <Rows>
            {o.servers.map((s, i) => (
              <Row
                key={s.id}
                first={i === 0}
                last={i === o.servers.length - 1}
                title={s.name}
                subtitle={`${(s.sent24h ?? 0).toLocaleString()} sent today · ${(s.bounced24h ?? 0).toLocaleString()} bounced · ${(s.held ?? 0).toLocaleString()} held`}
                right={s.mode === "Development" ? <Pill tone="warn">Dev</Pill> : s.suspended ? <Pill tone="error">Suspended</Pill> : <Pill tone="ok">Live</Pill>}
                onPress={() => router.push({ pathname: "/sending/[id]", params: { id: s.id, name: s.name } })}
              />
            ))}
          </Rows>
        ) : null}

        {o ? (
          <View style={{ gap: 4 }}>
            <Body dim size={12.5}>SMTP {o.smtp.host}:{o.smtp.port} ({o.smtp.security})</Body>
            <Body dim size={12.5}>API {o.api.url}</Body>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
