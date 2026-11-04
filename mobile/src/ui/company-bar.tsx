// Which company you are looking at: one tap each, with what is unread on it.
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useSession, type Unread } from "@/lib/session";
import { initials } from "@/lib/format";
import { radius, space, useTheme } from "@/lib/theme";

export function CompanyBar({ cid, onPick, unread }: { cid?: string; onPick: (id: string) => void; unread?: Unread }) {
  const t = useTheme();
  const { me } = useSession();
  const companies = me?.companies ?? [];
  if (companies.length < 2) {
    const only = companies[0];
    return (
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.md }}>
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: "700", letterSpacing: -0.4 }}>{only?.name ?? "Mail"}</Text>
      </View>
    );
  }
  return (
    <FlatList
      horizontal
      data={companies}
      keyExtractor={(c) => c.id}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.sm, paddingVertical: space.sm, alignItems: "center" }}
      renderItem={({ item }) => {
        const on = item.id === cid;
        const n = unread?.[item.id]?.inbox ?? 0;
        return (
          <Pressable
            onPress={() => onPick(item.id)}
            style={{
              flexDirection: "row", alignItems: "center", gap: 8,
              paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md,
              backgroundColor: on ? t.panel : "transparent",
              borderWidth: StyleSheet.hairlineWidth, borderColor: on ? t.line : "transparent",
            }}
          >
            <View style={{ width: 22, height: 22, borderRadius: 7, backgroundColor: item.color, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: "#fff", fontSize: 10, fontWeight: "800" }}>{initials(item.name)}</Text>
            </View>
            <Text style={{ color: on ? t.ink : t.ink3, fontWeight: on ? "700" : "500", fontSize: 15 }}>{item.name}</Text>
            {n > 0 ? (
              <View style={{ backgroundColor: t.brand, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 1 }}>
                <Text style={{ color: t.onBrand, fontSize: 11, fontWeight: "800" }}>{n}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      }}
    />
  );
}
