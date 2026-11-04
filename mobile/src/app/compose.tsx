// Writing a message: new, a reply, or a forward. It is saved as a draft in the
// company's mailbox and then sent from the address it is written as, the same
// way the web app does it (lib/jmap.ts).
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { saveDraft, sendDraft, type Draft } from "@/lib/jmap";

import { bodyText, displayName, parseAddresses, quote } from "@/lib/format";
import { radius, space, useTheme } from "@/lib/theme";
import { Body, Button, Field, Input, Loading, Notice } from "@/ui/kit";

export default function Compose() {
  const t = useTheme();
  const params = useLocalSearchParams<{ cid: string; kind?: string; emailId?: string; to?: string }>();
  const cid = String(params.cid);
  const kind = (params.kind as "reply" | "forward" | undefined) ?? "new";
  const { company, jmap } = useSession();
  const c = company(cid);

  // What this message starts as: the mailbox's folders and identities, and the
  // message being answered. Read once; the edits below start from it.
  const { data: start, error: loadError } = useLoad(async () => {
    const j = jmap(cid);
    const [boxes, identities] = await Promise.all([j.mailboxes(), j.identities()]);
    const source = params.emailId ? await j.email(String(params.emailId)) : null;
    const subject = source?.subject ?? "";
    if (kind === "reply" && source) {
      // Answer from the address it was sent to, when that is one of ours.
      const ours = (source.to ?? []).find((a) => c?.addresses.some((x) => x.email.toLowerCase() === a.email.toLowerCase()));
      return {
        boxes, identities, replyTo: source,
        from: ours?.email ?? c?.email ?? identities[0]?.email ?? "",
        to: (source.replyTo?.[0] ?? source.from?.[0])?.email ?? "",
        subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
        text: quote(source),
      };
    }
    if (kind === "forward" && source) {
      return {
        boxes, identities, replyTo: null,
        from: c?.email ?? identities[0]?.email ?? "",
        to: "",
        subject: /^fwd:/i.test(subject) ? subject : `Fwd: ${subject}`,
        text: `\n\n---------- Forwarded message ----------\nFrom: ${displayName(source.from?.[0])} <${source.from?.[0]?.email ?? ""}>\nDate: ${source.receivedAt}\nSubject: ${subject}\n\n${bodyText(source)}`,
      };
    }
    return {
      boxes, identities, replyTo: null,
      from: c?.email ?? identities[0]?.email ?? "",
      to: String(params.to ?? ""),
      subject: "",
      text: "",
    };
  }, `${cid}:${kind}:${params.emailId ?? ""}`);

  // Anything typed wins over what it started as.
  const [edited, setEdited] = useState<{ from?: string; to?: string; subject?: string; text?: string }>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showFrom, setShowFrom] = useState(false);

  const from = edited.from ?? start?.from ?? "";
  const to = edited.to ?? start?.to ?? "";
  const subject = edited.subject ?? start?.subject ?? "";
  const text = edited.text ?? start?.text ?? "";
  const setFrom = (v: string) => setEdited((e) => ({ ...e, from: v }));
  const setTo = (v: string) => setEdited((e) => ({ ...e, to: v }));
  const setSubject = (v: string) => setEdited((e) => ({ ...e, subject: v }));
  const setText = (v: string) => setEdited((e) => ({ ...e, text: v }));

  async function send() {
    const recipients = parseAddresses(to);
    if (!recipients.length) return setError("Who is it for? Write an email address.");
    setBusy(true);
    setError("");
    try {
      const j = jmap(cid);
      const replyTo = start?.replyTo ?? null;
      const address = c?.addresses.find((a) => a.email.toLowerCase() === from.toLowerCase());
      const draft: Draft = {
        fromEmail: from,
        fromName: address?.displayName || c?.name || "",
        to: recipients,
        cc: [],
        bcc: [],
        subject: subject.trim(),
        text,
        html: `<div style="white-space:pre-wrap">${escapeHtml(text)}</div>`,
        attachments: [],
        ...(replyTo ? {
          inReplyTo: replyTo.messageId ?? undefined,
          references: [...(replyTo.references ?? []), ...(replyTo.messageId ?? [])],
          replyToEmailId: replyTo.id,
        } : {}),
      };
      const draftId = await saveDraft(j, start!.boxes, draft);
      await sendDraft(j, start!.boxes, start!.identities, draftId, from, replyTo?.id);
      router.back();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <View style={{ padding: space.lg }}><Notice tone="error">{loadError}</Notice></View>;
  if (!start) return <Loading label="Opening the mailbox" />;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{
        title: kind === "reply" ? "Reply" : kind === "forward" ? "Forward" : "New message",
        headerRight: () => <Button small title="Send" variant="primary" busy={busy} onPress={send} />,
      }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        {error ? <Notice tone="error">{error}</Notice> : null}

        <Pressable onPress={() => setShowFrom((s) => !s)}>
          <Field label="From">
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: t.panel, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: t.line, paddingHorizontal: 14, minHeight: 44 }}>
              <Text style={{ flex: 1, color: t.ink, fontSize: 15 }}>{from}</Text>
              <Text style={{ color: t.ink3 }}>{showFrom ? "▴" : "▾"}</Text>
            </View>
          </Field>
        </Pressable>
        {showFrom ? (
          <View style={{ gap: 6 }}>
            {(c?.addresses ?? []).map((a) => (
              <Pressable
                key={a.id}
                onPress={() => { setFrom(a.email); setShowFrom(false); }}
                style={{ padding: 12, borderRadius: radius.md, backgroundColor: a.email === from ? t.brandSoft : t.panel }}
              >
                <Text style={{ color: a.email === from ? t.brandInk : t.ink, fontSize: 14.5 }}>{a.email}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <Field label="To" hint="Several addresses: separate them with a comma.">
          <Input value={to} onChangeText={setTo} placeholder="someone@example.com" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" />
        </Field>
        <Field label="Subject">
          <Input value={subject} onChangeText={setSubject} placeholder="What it is about" />
        </Field>
        <Field label="Message">
          <Input value={text} onChangeText={setText} multiline style={{ minHeight: 220 }} />
        </Field>
        <Body dim size={12.5}>Sent through this company’s own mail server, signed as {c?.domain}.</Body>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const escapeHtml = (s: string) => s.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch] ?? ch));
