// Every device signed in to this account, and signing one out from here.
import { Alert, RefreshControl, ScrollView } from "react-native";
import { del, get } from "@/lib/api";
import { useLoad } from "@/lib/use-load";
import { relative } from "@/lib/format";
import { space, useTheme } from "@/lib/theme";
import { Body, Loading, Notice, Pill, Row, Rows } from "@/ui/kit";

type Device = { id: string; label: string; createdAt: number; lastSeen: number; current: boolean };

export default function Devices() {
  const t = useTheme();
  const { data: list, error, busy, refresh } = useLoad(() => get<Device[]>("/api/auth/devices"));

  const revoke = (d: Device) => Alert.alert(`Sign out ${d.label}?`, "That device will need the password again.", [
    { text: "Cancel", style: "cancel" },
    {
      text: "Sign it out", style: "destructive", onPress: async () => {
        try {
          await del(`/api/auth/devices/${encodeURIComponent(d.id)}`);
          refresh();
        } catch (e) {
          Alert.alert("That did not work", (e as Error).message);
        }
      },
    },
  ]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 48 }}
      refreshControl={<RefreshControl refreshing={busy} onRefresh={refresh} tintColor={t.ink3} />}
    >
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!list && !error ? <Loading /> : null}
      {list ? (
        <Rows>
          {list.map((d, i) => (
            <Row
              key={d.id}
              first={i === 0}
              last={i === list.length - 1}
              title={d.label}
              subtitle={`Last used ${relative(d.lastSeen)} · signed in ${relative(d.createdAt)}`}
              right={d.current ? <Pill tone="brand">This one</Pill> : undefined}
              onPress={d.current ? undefined : () => revoke(d)}
            />
          ))}
        </Rows>
      ) : null}
      <Body dim size={12.5}>
        The browser’s own sessions are not listed here; changing the account’s password signs everything out.
      </Body>
    </ScrollView>
  );
}
