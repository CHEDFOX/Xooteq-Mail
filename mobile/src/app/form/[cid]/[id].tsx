// One contact form: where it posts, the code to paste, what it has received,
// and a test that goes all the way to the inbox.
import { useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { del, get, post } from "@/lib/api";
import { useLoad } from "@/lib/use-load";
import type { ContactForm, FormSubmission } from "@/lib/types";
import { relative } from "@/lib/format";
import { radius, space, useTheme } from "@/lib/theme";
import { Body, Button, Card, Loading, Mono, Notice, Pill, Title } from "@/ui/kit";

export default function FormScreen() {
  const t = useTheme();
  const { cid, id } = useLocalSearchParams<{ cid: string; id: string }>();
  const base = `/api/companies/${encodeURIComponent(String(cid))}/forms/${String(id)}`;
  const { data: form, error } = useLoad(() => get<ContactForm>(base), base);
  const [subs, setSubs] = useState<FormSubmission[] | null>(null);
  const [busy, setBusy] = useState("");

  const loadSubs = async () => {
    setBusy("subs");
    try {
      const out = await get<{ submissions: FormSubmission[] }>(`${base}/submissions?n=25`);
      setSubs(out.submissions);
    } catch (e) {
      Alert.alert("Can't read them", (e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const test = async () => {
    setBusy("test");
    try {
      const out = await post<{ ok: boolean; error?: string }>(`${base}/test`);
      Alert.alert(out.ok ? "Test sent" : "Not sent", out.ok ? `It should reach ${form?.email} in a moment.` : out.error ?? "The form refused it.");
    } catch (e) {
      Alert.alert("Not sent", (e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const remove = () => Alert.alert("Remove this form?", "The site's form stops working at once. Mail already received stays.", [
    { text: "Cancel", style: "cancel" },
    {
      text: "Remove", style: "destructive", onPress: async () => {
        try {
          await del(base);
          router.back();
        } catch (e) {
          Alert.alert("That did not work", (e as Error).message);
        }
      },
    },
  ]);

  const copy = async (text: string, what: string) => {
    await Clipboard.setStringAsync(text);
    Alert.alert(`${what} copied`);
  };

  if (error) return <View style={{ padding: space.lg }}><Notice tone="error">{error}</Notice></View>;
  if (!form) return <Loading />;

  const snippet = [
    `await fetch("${form.endpoint}", {`,
    `  method: "POST",`,
    `  headers: { "content-type": "application/json" },`,
    `  body: JSON.stringify({ name, email, message }),`,
    `});`,
  ].join("\n");

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 48 }}>
      <Stack.Screen options={{ title: form.name }} />
      <View style={{ gap: 4 }}>
        <Title>{form.name}</Title>
        <Body dim size={13.5}>Delivers to {form.email}, sent by {form.appName}.</Body>
        <View style={{ flexDirection: "row", gap: 6, marginTop: 4 }}>
          <Pill tone={form.enabled ? "ok" : "warn"}>{form.enabled ? "On" : "Off"}</Pill>
          {form.allowNoOrigin ? <Pill tone="brand">Apps may post</Pill> : null}
          {form.autoreply ? <Pill>Answers the visitor</Pill> : null}
        </View>
      </View>

      <Card title="Where it posts">
        <View style={{ backgroundColor: t.panel2, borderRadius: radius.md, padding: space.md }}>
          <Mono size={12}>{form.endpoint}</Mono>
        </View>
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Button small title="Copy address" onPress={() => copy(form.endpoint, "Address")} style={{ flex: 1 }} />
          <Button small title="Copy the code" onPress={() => copy(snippet, "Code")} style={{ flex: 1 }} />
        </View>
        <View style={{ backgroundColor: t.panel2, borderRadius: radius.md, padding: space.md }}>
          <Mono size={11.5}>{snippet}</Mono>
        </View>
        <Body dim size={12.5}>
          Every field is sent along and becomes a line in the mail; an <Body size={12.5}>email</Body> field becomes Reply-To.
        </Body>
      </Card>

      <Card title="Does it work?" subtitle="Posts a message through the form exactly as a browser or an app would.">
        <Button title="Send a test" busy={busy === "test"} onPress={test} />
      </Card>

      <Card title="Submissions" subtitle="Everything this form received, mail or no mail.">
        <Button title={subs ? "Refresh" : "Show the last 25"} busy={busy === "subs"} onPress={loadSubs} />
        {subs?.length === 0 ? <Body dim size={13}>Nothing yet.</Body> : null}
        {(subs ?? []).map((s) => (
          <View key={s.id} style={{ backgroundColor: t.panel2, borderRadius: radius.md, padding: space.md, gap: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Pill tone={s.status === "sent" ? "ok" : s.status === "failed" ? "error" : "warn"}>{s.status}</Pill>
              <Body dim size={12}>{relative(Date.parse(s.at))}</Body>
            </View>
            {Object.entries(s.fields).map(([k, v]) => (
              <Body key={k} size={13}><Body size={13} dim>{k}: </Body>{v}</Body>
            ))}
          </View>
        ))}
      </Card>

      <Button title="Remove this form" variant="danger" onPress={remove} />
    </ScrollView>
  );
}
