// The four places the app goes: the mail itself, the contact forms, what the
// apps send, and the settings behind all of it.
import { Tabs } from "expo-router/tabs";
import { Text, type ColorValue } from "react-native";
import { useTheme } from "@/lib/theme";
import { useSession } from "@/lib/session";

/** The tab bar's glyphs, drawn as text so the app carries no icon font. */
function Glyph({ mark, color }: { mark: string; color: ColorValue }) {
  return <Text style={{ fontSize: 19, color, lineHeight: 23 }}>{mark}</Text>;
}

export default function AppTabs() {
  const t = useTheme();
  const { unread } = useSession();
  const inbox = Object.values(unread).reduce((n, u) => n + (u?.inbox ?? 0), 0);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.brandInk,
        tabBarInactiveTintColor: t.ink3,
        tabBarStyle: { backgroundColor: t.panel, borderTopColor: t.line },
        tabBarLabelStyle: { fontSize: 11.5, fontWeight: "600" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Mail",
          tabBarBadge: inbox || undefined,
          tabBarIcon: ({ color }) => <Glyph mark="✉" color={color} />,
        }}
      />
      <Tabs.Screen name="forms" options={{ title: "Forms", tabBarIcon: ({ color }) => <Glyph mark="▤" color={color} /> }} />
      <Tabs.Screen name="sending" options={{ title: "Sending", tabBarIcon: ({ color }) => <Glyph mark="➤" color={color} /> }} />
      <Tabs.Screen name="settings" options={{ title: "Settings", tabBarIcon: ({ color }) => <Glyph mark="⚙" color={color} /> }} />
    </Tabs>
  );
}
