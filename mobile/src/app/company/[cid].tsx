// One company on the phone: its addresses, what each one is filed under, and
// whether the AI answers it. The same calls the web app's Addresses tab makes.
import { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { get, patch } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { AiMode, Address, Company, Rule } from "@/lib/types";
import { space, useTheme } from "@/lib/theme";
import { Body, Card, Loading, Notice, Pill, Row, Rows, Segmented, Title } from "@/ui/kit";

type FullCompany = Company & { rules: Rule[] };

export default function CompanyScreen() {
  const t = useTheme();
  const { cid } = useLocalSearchParams<{ cid: string }>();
  const { refresh } = useSession();
  const [c, setC] = useState<FullCompany | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(() => {
    get<FullCompany>(`/api/companies/${encodeURIComponent(String(cid))}`)
      .then(setC)
      .catch((e) => setError((e as Error).message));
  }, [cid]);
  useEffect(() => { load(); }, [load]);

  async function setMode(a: Address, mode: AiMode) {
    setBusy(a.id);
    try {
      const next = await patch<Company>(`/api/companies/${encodeURIComponent(String(cid))}/addresses/${a.id}`, { aiMode: mode });
      setC((old) => (old ? { ...next, rules: old.rules } : old));
      refresh();
    } catch (e) {
      Alert.alert("That did not work", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (error) return <View style={{ padding: space.lg }}><Notice tone="error">{error}</Notice></View>;
  if (!c) return <Loading />;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 48 }}>
      <Stack.Screen options={{ title: c.name }} />

      <View style={{ gap: 4 }}>
        <Title>{c.name}</Title>
        <Body dim size={13.5}>{c.domain} · {c.addresses.length} {c.addresses.length === 1 ? "address" : "addresses"}</Body>
      </View>

      {c.addresses.map((a) => (
        <Card key={a.id} title={a.email} subtitle={a.isPrimary ? "The mailbox itself; its mail arrives in the Inbox." : `Filed in “${a.label}”`}>
          <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
            {a.isPrimary ? <Pill>Main</Pill> : null}
            {a.autoReply?.enabled ? <Pill tone="ok">Auto-reply on</Pill> : null}
          </View>
          <Body dim size={12.5}>Sends as {a.displayName || c.name}</Body>
          <Segmented
            value={a.aiMode}
            onChange={(mode) => setMode(a, mode)}
            options={[
              { value: "off" as AiMode, label: "No AI" },
              { value: "draft" as AiMode, label: "AI drafts" },
              { value: "send" as AiMode, label: "AI sends" },
            ]}
          />
          {busy === a.id ? <Body dim size={12}>Saving…</Body> : null}
        </Card>
      ))}

      <Rows>
        <Row
          first
          last
          title="Forms on this company"
          subtitle="The contact forms that deliver to these addresses"
          onPress={() => router.push({ pathname: "/(app)/forms", params: { cid: c.id } })}
        />
      </Rows>

      <Notice>Adding an address, writing rules and changing the AI’s voice are done in the browser; everything here is what a phone is good for.</Notice>
    </ScrollView>
  );
}
