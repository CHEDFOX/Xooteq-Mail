// The inbox: one company at a time, a folder, and the conversations in it.
// Pull to refresh, swipe-free actions on the thread itself, and the button that
// writes a new message.
import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import type { ThreadRow } from "@/lib/jmap";
import type { Mailbox } from "@/lib/types";
import { displayName, localOf, shortTime } from "@/lib/format";
import { onNotificationArrived } from "@/lib/push";
import { radius, space, useTheme } from "@/lib/theme";
import { Avatar, Body, Empty, Loading, Notice } from "@/ui/kit";
import { CompanyBar } from "@/ui/company-bar";

const BOXES = [
  { id: "inbox", label: "Inbox", role: "inbox" },
  { id: "drafts", label: "Drafts", role: "drafts" },
  { id: "sent", label: "Sent", role: "sent" },
  { id: "archive", label: "Archive", role: "archive" },
  { id: "junk", label: "Junk", role: "junk" },
  { id: "trash", label: "Trash", role: "trash" },
] as const;
type BoxId = (typeof BOXES)[number]["id"];

export default function MailScreen() {
  const t = useTheme();
  const { me, jmap, offline, refreshUnread, unread } = useSession();
  const [cid, setCid] = useState<string | undefined>(undefined);
  const [box, setBox] = useState<BoxId>("inbox");
  const [address, setAddress] = useState<string | null>(null);

  const company = me?.companies.find((c) => c.id === cid) ?? me?.companies[0];

  const { data, error, busy, refresh } = useLoad(async () => {
    if (!company) return { boxes: [] as Mailbox[], rows: [] as ThreadRow[] };
    const j = jmap(company.id);
    const boxes = await j.mailboxes();
    const want = BOXES.find((b) => b.id === box)!;
    const folder = boxes.find((m) => m.role === want.role) ?? boxes.find((m) => m.name.toLowerCase() === want.label.toLowerCase());
    if (!folder) return { boxes, rows: [] as ThreadRow[] };
    const filter: Record<string, unknown> = { inMailbox: folder.id };
    if (address) filter.to = address;
    const { rows } = await j.threads(filter, 0, 60);
    return { boxes, rows };
  }, `${company?.id ?? ""}:${box}:${address ?? ""}`);

  const rows = data?.rows ?? null;
  const boxes = data?.boxes ?? [];

  // Coming back to the tab, and a notification arriving, both mean new mail.
  useFocusEffect(useCallback(() => { refreshUnread(); }, [refreshUnread]));
  useEffect(() => onNotificationArrived((push) => {
    if (!push.companyId || push.companyId === company?.id) refresh();
    refreshUnread();
  }), [company?.id, refresh, refreshUnread]);

  const addresses = company?.addresses ?? [];

  if (!me) return null;
  if (!me.companies.length) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={["top"]}>
        <Empty title="No companies yet">Add one in the browser at Settings → Add a company, then pull to refresh here.</Empty>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={["top"]}>
      <CompanyBar cid={company?.id} onPick={setCid} unread={unread} />

      <View style={{ flexDirection: "row", gap: 6, paddingHorizontal: space.lg, paddingBottom: space.sm, alignItems: "center" }}>
        {BOXES.filter((b) => ["inbox", "drafts", "sent", "archive"].includes(b.id)).map((b) => {
          const on = b.id === box;
          return (
            <Pressable
              key={b.id}
              onPress={() => setBox(b.id)}
              style={{
                paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill,
                backgroundColor: on ? t.brandSoft : t.panel,
                borderWidth: StyleSheet.hairlineWidth, borderColor: on ? "transparent" : t.line,
              }}
            >
              <Text style={{ color: on ? t.brandInk : t.ink2, fontWeight: on ? "700" : "500", fontSize: 13 }}>{b.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {addresses.length > 1 ? (
        <FlatList
          horizontal
          data={[{ id: 0, email: "", label: "All" }, ...addresses]}
          keyExtractor={(a) => String(a.id)}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: space.lg, gap: 6, paddingBottom: space.sm, alignItems: "center" }}
          renderItem={({ item }) => {
            const on = (item.email || null) === address;
            return (
              <Pressable
                onPress={() => setAddress(item.email || null)}
                style={{
                  paddingHorizontal: 11, paddingVertical: 5, borderRadius: radius.pill,
                  backgroundColor: on ? t.sunken : "transparent",
                  borderWidth: StyleSheet.hairlineWidth, borderColor: on ? "transparent" : t.line,
                }}
              >
                <Text style={{ color: on ? t.ink : t.ink3, fontSize: 12.5, fontWeight: on ? "600" : "500" }}>
                  {item.email ? localOf(item.email) : "All"}
                </Text>
              </Pressable>
            );
          }}
        />
      ) : null}

      {offline ? <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}><Notice>No connection. This is the last mail this phone saw.</Notice></View> : null}
      {error ? <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}><Notice tone="error">{error}</Notice></View> : null}

      {rows === null ? <Loading /> : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={rows.length ? { paddingBottom: 96 } : { flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={busy} onRefresh={refresh} tintColor={t.ink3} />}
          ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.line2, marginLeft: 66 }} />}
          ListEmptyComponent={<Empty title={`Nothing in ${BOXES.find((b) => b.id === box)!.label}`}>Mail to {company?.domain} arrives here.</Empty>}
          renderItem={({ item }) => <ThreadLine row={item} cid={company!.id} boxes={boxes} />}
        />
      )}

      <Pressable
        accessibilityLabel="Write a message"
        onPress={() => router.push({ pathname: "/compose", params: { cid: company!.id } })}
        style={({ pressed }) => ({
          position: "absolute", right: space.lg, bottom: space.lg,
          width: 56, height: 56, borderRadius: 18,
          backgroundColor: t.primaryBg, alignItems: "center", justifyContent: "center",
          opacity: pressed ? 0.85 : 1,
          shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4,
        })}
      >
        <Text style={{ color: t.primaryFg, fontSize: 24, marginTop: -2 }}>✎</Text>
      </Pressable>
    </SafeAreaView>
  );
}

function ThreadLine({ row, cid, boxes }: { row: ThreadRow; cid: string; boxes: Mailbox[] }) {
  const t = useTheme();
  const who = row.from?.[0] ?? row.to?.[0];
  const drafts = boxes.find((b) => b.role === "drafts");
  const isDraft = !!drafts && !!row.mailboxIds?.[drafts.id];
  return (
    <Pressable
      onPress={() => router.push({ pathname: "/thread/[cid]/[id]", params: { cid, id: row.threadId, emailId: row.id } })}
      style={({ pressed }) => ({
        flexDirection: "row", gap: space.md, padding: space.md, paddingHorizontal: space.lg,
        backgroundColor: pressed ? t.panel2 : t.bg,
      })}
    >
      <Avatar name={displayName(who)} email={who?.email ?? "?"} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text numberOfLines={1} style={{ flex: 1, color: t.ink, fontSize: 15, fontWeight: row.unread ? "700" : "500" }}>
            {isDraft ? "Draft" : displayName(who)}
            {row.count > 1 ? <Text style={{ color: t.ink3, fontWeight: "500" }}>  {row.count}</Text> : null}
          </Text>
          <Text style={{ color: row.unread ? t.brandInk : t.ink3, fontSize: 12, fontWeight: row.unread ? "700" : "500" }}>
            {shortTime(row.receivedAt)}
          </Text>
        </View>
        <Text numberOfLines={1} style={{ color: t.ink, fontSize: 14, fontWeight: row.unread ? "600" : "500" }}>
          {row.subject || "(no subject)"}
        </Text>
        <Body dim size={13} numberOfLines={1}>{row.preview ?? ""}</Body>
      </View>
      {row.unread ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.brand, alignSelf: "center" }} /> : null}
    </Pressable>
  );
}
