// What the AI has been doing: every message it looked at, what it did and why.
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { get } from "@/lib/api";
import { useLoad } from "@/lib/use-load";
import { useSession } from "@/lib/session";
import type { AiRun } from "@/lib/types";
import { relative } from "@/lib/format";
import { radius, space, useTheme } from "@/lib/theme";
import { Body, Empty, Loading, Notice, Pill } from "@/ui/kit";

const STATUS: Record<string, { tone: "ok" | "warn" | "error" | "neutral" | "ai"; label: string }> = {
  sent: { tone: "ok", label: "Sent" },
  drafted: { tone: "ai", label: "Draft to check" },
  needs_person: { tone: "warn", label: "Needs you" },
  skipped: { tone: "neutral", label: "Left alone" },
  error: { tone: "error", label: "Failed" },
  working: { tone: "neutral", label: "Working" },
  scheduled: { tone: "ai", label: "Sending soon" },
  sending: { tone: "neutral", label: "Sending" },
  cancelled: { tone: "neutral", label: "Stopped" },
};

export default function Activity() {
  const t = useTheme();
  const { me } = useSession();
  const { data: runs, error, busy, refresh } = useLoad(() => get<AiRun[]>("/api/ai/runs?limit=100"));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: 48 }}
      refreshControl={<RefreshControl refreshing={busy} onRefresh={refresh} tintColor={t.ink3} />}
    >
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!runs && !error ? <Loading /> : null}
      {runs?.length === 0 ? <Empty title="Nothing yet">When an address has AI replies on, every message it answers or leaves alone shows up here.</Empty> : null}

      {(runs ?? []).map((r) => {
        const st = STATUS[r.status] ?? { tone: "neutral" as const, label: r.status };
        const company = me?.companies.find((c) => c.id === r.company_id);
        return (
          <View key={r.id} style={{ backgroundColor: t.panel, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: t.line, padding: space.md, gap: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              {company ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: company.color }} /> : null}
              <Body size={14} numberOfLines={1} style={{ flex: 1 }}>{r.sender || "Unknown sender"}</Body>
              <Pill tone={st.tone}>{st.label}</Pill>
            </View>
            <Body size={13.5} numberOfLines={1}>{r.subject || "(no subject)"}</Body>
            {r.reason ? <Body dim size={12.5}>{r.reason}</Body> : null}
            <Body dim size={11.5}>{r.address ?? ""} · {relative(r.created_at)}</Body>
          </View>
        );
      })}
    </ScrollView>
  );
}
