// One conversation: every message in it, oldest first, and what to do about it
// — reply, forward, archive, delete, mark unread, star.
import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import type { Email, Mailbox } from "@/lib/types";
import { addressList, bodyText, bytes, displayName, longTime } from "@/lib/format";
import { radius, space, useTheme } from "@/lib/theme";
import { Avatar, Body, Button, Loading, Notice, Pill } from "@/ui/kit";

export default function ThreadScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ cid: string; id: string; emailId?: string }>();
  const cid = String(params.cid);
  const threadId = String(params.id);
  const { jmap, refreshUnread } = useSession();
  const [busy, setBusy] = useState("");
  const [opened, setOpened] = useState<string | null>(null);

  const { data, error } = useLoad(async () => {
    const j = jmap(cid);
    const [list, all] = await Promise.all([j.thread(threadId), j.mailboxes()]);
    // Opening a conversation reads it.
    const unseen = list.filter((e) => !e.keywords?.$seen).map((e) => e.id);
    if (unseen.length) {
      await j.setKeyword(unseen, "$seen", true);
      refreshUnread();
    }
    return { list, all };
  }, `${cid}:${threadId}`);

  const emails: Email[] | null = data?.list ?? null;
  const boxes: Mailbox[] = data?.all ?? [];
  // The newest message is the one open, until another is tapped.
  const open = opened ?? emails?.[emails.length - 1]?.id ?? null;

  const act = async (key: string, fn: () => Promise<void>, leave = true) => {
    setBusy(key);
    try {
      await fn();
      refreshUnread();
      if (leave) router.back();
    } catch (e) {
      Alert.alert("That did not work", (e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const archive = () => act("archive", async () => {
    const j = jmap(cid);
    const archiveId = await j.archive(boxes);
    const inbox = boxes.find((b) => b.role === "inbox");
    await j.setMailboxes(emails ?? [], (current) => {
      if (inbox) delete current[inbox.id];
      return { ...current, [archiveId]: true };
    });
  });

  const remove = () => {
    const trash = boxes.find((b) => b.role === "trash");
    Alert.alert("Delete this conversation?", trash ? "It goes to Trash." : "It is deleted from the server.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive", onPress: () => act("delete", async () => {
          const j = jmap(cid);
          if (trash) await j.setMailboxes(emails ?? [], () => ({ [trash.id]: true }));
          else await j.destroy((emails ?? []).map((e) => e.id));
        }),
      },
    ]);
  };

  const unread = () => act("unread", async () => {
    const last = emails?.[emails.length - 1];
    if (last) await jmap(cid).setKeyword([last.id], "$seen", false);
  });

  const last = emails?.[emails.length - 1];

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen options={{ title: last?.subject?.slice(0, 40) || "Conversation" }} />
      {error ? <View style={{ padding: space.lg }}><Notice tone="error">{error}</Notice></View> : null}
      {!emails ? <Loading /> : (
        <>
          <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 120 }}>
            <Text style={{ color: t.ink, fontSize: 20, fontWeight: "700", letterSpacing: -0.3 }}>
              {last?.subject || "(no subject)"}
            </Text>
            {emails.map((e) => (
              <Message
                key={e.id}
                email={e}
                cid={cid}
                expanded={open === e.id || emails.length === 1}
                onToggle={() => setOpened(open === e.id ? "" : e.id)}
              />
            ))}
          </ScrollView>

          <View style={{
            position: "absolute", left: 0, right: 0, bottom: 0,
            flexDirection: "row", gap: space.sm, padding: space.md,
            backgroundColor: t.panel, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line,
          }}>
            <Button
              title="Reply"
              variant="primary"
              style={{ flex: 1 }}
              onPress={() => last && router.push({ pathname: "/compose", params: { cid, kind: "reply", emailId: last.id } })}
            />
            <Button
              title="Forward"
              style={{ flex: 1 }}
              onPress={() => last && router.push({ pathname: "/compose", params: { cid, kind: "forward", emailId: last.id } })}
            />
            <Button title="Archive" busy={busy === "archive"} onPress={archive} />
            <Button title="⋯" onPress={() => Alert.alert("This conversation", undefined, [
              { text: "Mark unread", onPress: unread },
              { text: "Delete", style: "destructive", onPress: remove },
              { text: "Cancel", style: "cancel" },
            ])} />
          </View>
        </>
      )}
    </View>
  );
}

function Message({ email, cid, expanded, onToggle }: { email: Email; cid: string; expanded: boolean; onToggle: () => void }) {
  const t = useTheme();
  const { jmap } = useSession();
  const from = email.from?.[0];
  const text = bodyText(email);
  const attachments = (email.attachments ?? []).filter((a) => a.disposition !== "inline" || a.name);
  return (
    <View style={{ backgroundColor: t.panel, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: t.line, overflow: "hidden" }}>
      <Pressable onPress={onToggle} style={{ flexDirection: "row", gap: space.md, padding: space.md }}>
        <Avatar name={displayName(from)} email={from?.email ?? "?"} size={34} />
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text numberOfLines={1} style={{ flex: 1, color: t.ink, fontSize: 14.5, fontWeight: "600" }}>{displayName(from)}</Text>
            {email.keywords?.$draft ? <Pill tone="warn">Draft</Pill> : null}
            {email.keywords?.$ai_draft ? <Pill tone="ai">AI</Pill> : null}
          </View>
          <Body dim size={12.5} numberOfLines={1}>
            {expanded ? `to ${addressList(email.to) || "you"}` : (email.preview ?? "")}
          </Body>
          {expanded ? <Body dim size={12}>{longTime(email.receivedAt)}</Body> : null}
        </View>
      </Pressable>
      {expanded ? (
        <View style={{ paddingHorizontal: space.md, paddingBottom: space.md, gap: space.sm }}>
          <Text selectable style={{ color: t.ink, fontSize: 15, lineHeight: 22 }}>{text}</Text>
          {attachments.length ? (
            <View style={{ gap: 6, marginTop: 4 }}>
              {attachments.map((a) => (
                <View key={a.blobId ?? a.partId} style={{ flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: t.panel2, borderRadius: radius.sm, padding: 10 }}>
                  <Text style={{ fontSize: 15 }}>📎</Text>
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ color: t.ink, fontSize: 13.5 }}>{a.name ?? "Attachment"}</Text>
                    <Text style={{ color: t.ink3, fontSize: 11.5 }}>{bytes(a.size)} · {a.type}</Text>
                  </View>
                  <Button
                    small
                    title="Open"
                    onPress={() => {
                      const { uri } = jmap(cid).blob(a.blobId!, a.name ?? "file", a.type);
                      // The server needs the token, so the app cannot simply hand
                      // the address to the browser; it says where the file is.
                      Alert.alert(a.name ?? "Attachment", `Open this on the web app:\n\n${uri}`);
                    }}
                  />
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
