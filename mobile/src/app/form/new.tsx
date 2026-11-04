// Connecting a form from the phone: name it, pick the address it delivers to,
// say who may post, and the server does the rest (its domain and key in Postal).
import { useState } from "react";
import { ScrollView, Switch, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { post } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { ContactForm } from "@/lib/types";
import { space, useTheme } from "@/lib/theme";
import { Body, Button, Field, Input, Notice, Row, Rows } from "@/ui/kit";

export default function NewForm() {
  const t = useTheme();
  const { cid } = useLocalSearchParams<{ cid: string }>();
  const { company } = useSession();
  const c = company(String(cid));
  const [name, setName] = useState("");
  // The address its mail goes to, and the sites allowed to post, start from the
  // company itself and are only state once they are changed.
  const [picked, setPicked] = useState<number | null>(null);
  const [typedOrigins, setTypedOrigins] = useState<string | null>(null);
  const addressId = picked ?? (c?.addresses.find((a) => !a.isPrimary) ?? c?.addresses[0])?.id ?? null;
  const origins = typedOrigins ?? (c ? `https://${c.domain}` : "");
  const [fromApps, setFromApps] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function connect() {
    if (!c || !addressId) return;
    setBusy(true);
    setError("");
    try {
      const form = await post<ContactForm>(`/api/companies/${encodeURIComponent(c.id)}/forms`, {
        name: name.trim() || "Contact form",
        addressId,
        origins: origins.split(/[\s,]+/).filter(Boolean),
        allowNoOrigin: fromApps,
      });
      router.replace({ pathname: "/form/[cid]/[id]", params: { cid: c.id, id: form.id } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!c) return <View style={{ padding: space.lg }}><Notice tone="error">That company is gone.</Notice></View>;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: "Connect a form" }} />

      <Field label="What is it" hint="For your own list: the page or the app it is on.">
        <Input value={name} onChangeText={setName} placeholder="Contact page" />
      </Field>

      <View style={{ gap: 6 }}>
        <Body size={13} style={{ fontWeight: "600" }}>Messages arrive at</Body>
        <Rows>
          {c.addresses.map((a, i) => (
            <Row
              key={a.id}
              first={i === 0}
              last={i === c.addresses.length - 1}
              title={a.email}
              subtitle={a.isPrimary ? "The main address" : `Filed in “${a.label}”`}
              right={a.id === addressId ? <Body style={{ color: t.brandInk, fontWeight: "700" }}>✓</Body> : undefined}
              onPress={() => setPicked(a.id)}
            />
          ))}
        </Rows>
      </View>

      <Field label="Sites allowed to post" hint={`One per line. Empty allows any site. “*.${c.domain}” covers every subdomain.`}>
        <Input value={origins} onChangeText={setTypedOrigins} multiline autoCapitalize="none" autoCorrect={false} style={{ minHeight: 72 }} />
      </Field>

      <View style={{ flexDirection: "row", gap: space.md, alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <Body size={14.5}>A message written in an app</Body>
          <Body dim size={12.5}>Apps and servers send no site address, so the list above cannot be checked for them.</Body>
        </View>
        <Switch value={fromApps} onValueChange={setFromApps} />
      </View>

      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button title="Connect" variant="primary" busy={busy} onPress={connect} disabled={!addressId} />
      <Body dim size={12.5}>
        The subject, a thank-you page, an answer to the visitor and the rate limits are set in the browser; this makes the form itself.
      </Body>
    </ScrollView>
  );
}
