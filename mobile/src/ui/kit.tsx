// The handful of pieces every screen is built from, in the Xooteq look.
import type { ReactNode } from "react";
import {
  ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
  type StyleProp, type TextInputProps, type TextStyle, type ViewStyle,
} from "react-native";
import { radius, space, useTheme, type Theme } from "@/lib/theme";

export function Screen({ children, style, scroll, refreshControl }: {
  children: ReactNode; style?: StyleProp<ViewStyle>; scroll?: boolean; refreshControl?: React.ReactElement;
}) {
  const t = useTheme();
  if (scroll) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: t.bg }}
        contentContainerStyle={[{ padding: space.lg, paddingBottom: 48, gap: space.md }, style]}
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
      >
        {children}
      </ScrollView>
    );
  }
  return <View style={[{ flex: 1, backgroundColor: t.bg }, style]}>{children}</View>;
}

export function Title({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const t = useTheme();
  return <Text style={[{ color: t.ink, fontSize: 22, fontWeight: "700", letterSpacing: -0.3 }, style]}>{children}</Text>;
}

export function Body({ children, dim, size = 15, weight = "400", numberOfLines, style }: {
  children: ReactNode; dim?: boolean; size?: number; weight?: TextStyle["fontWeight"]; numberOfLines?: number; style?: StyleProp<TextStyle>;
}) {
  const t = useTheme();
  return (
    <Text numberOfLines={numberOfLines} style={[{ color: dim ? t.ink3 : t.ink, fontSize: size, fontWeight: weight, lineHeight: size * 1.4 }, style]}>
      {children}
    </Text>
  );
}

const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

export function Mono({ children, size = 13, style }: { children: ReactNode; size?: number; style?: StyleProp<TextStyle> }) {
  const t = useTheme();
  return <Text style={[{ color: t.ink2, fontSize: size, fontFamily: MONO }, style]} selectable>{children}</Text>;
}

export function Card({ children, style, title, subtitle }: {
  children?: ReactNode; style?: StyleProp<ViewStyle>; title?: string; subtitle?: ReactNode;
}) {
  const t = useTheme();
  return (
    <View style={[{ backgroundColor: t.panel, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: t.line, padding: space.lg, gap: space.sm }, style]}>
      {title ? <Text style={{ color: t.ink, fontSize: 16, fontWeight: "600" }}>{title}</Text> : null}
      {subtitle ? <Body dim size={13}>{subtitle}</Body> : null}
      {children}
    </View>
  );
}

type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  busy?: boolean;
  disabled?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Button({ title, onPress, variant = "secondary", busy, disabled, small, style }: ButtonProps) {
  const t = useTheme();
  const look = buttonLook(t, variant);
  const off = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      style={({ pressed }) => [{
        height: small ? 34 : 44,
        paddingHorizontal: small ? 14 : 18,
        borderRadius: radius.md,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 8,
        backgroundColor: look.bg,
        borderWidth: look.border ? StyleSheet.hairlineWidth : 0,
        borderColor: t.line,
        opacity: off ? 0.5 : pressed ? 0.8 : 1,
      }, style]}
    >
      {busy ? <ActivityIndicator size="small" color={look.fg} /> : null}
      <Text style={{ color: look.fg, fontWeight: "600", fontSize: small ? 14 : 15 }}>{title}</Text>
    </Pressable>
  );
}

function buttonLook(t: Theme, variant: NonNullable<ButtonProps["variant"]>) {
  switch (variant) {
    case "primary": return { bg: t.primaryBg, fg: t.primaryFg, border: false };
    case "danger": return { bg: t.errorSoft, fg: t.error, border: false };
    case "ghost": return { bg: "transparent", fg: t.ink2, border: false };
    default: return { bg: t.panel, fg: t.ink, border: true };
  }
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: t.ink2, fontSize: 13, fontWeight: "600" }}>{label}</Text>
      {children}
      {hint ? <Body dim size={12.5}>{hint}</Body> : null}
    </View>
  );
}

export function Input(props: TextInputProps & { multiline?: boolean }) {
  const t = useTheme();
  return (
    <TextInput
      placeholderTextColor={t.ink4}
      {...props}
      style={[{
        backgroundColor: t.panel,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: t.line,
        borderRadius: radius.md,
        paddingHorizontal: 14,
        paddingVertical: props.multiline ? 12 : 11,
        minHeight: props.multiline ? 96 : 44,
        color: t.ink,
        fontSize: 15,
        textAlignVertical: props.multiline ? "top" : "center",
      }, props.style]}
    />
  );
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "ok" | "warn" | "error" | "brand" | "ai" }) {
  const t = useTheme();
  const tones = {
    neutral: { bg: t.sunken, fg: t.ink2 },
    ok: { bg: t.okSoft, fg: t.ok },
    warn: { bg: t.warnSoft, fg: t.warn },
    error: { bg: t.errorSoft, fg: t.error },
    brand: { bg: t.brandSoft, fg: t.brandInk },
    ai: { bg: t.aiSoft, fg: t.ai },
  }[tone];
  return (
    <View style={{ backgroundColor: tones.bg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill }}>
      <Text style={{ color: tones.fg, fontSize: 11.5, fontWeight: "700" }}>{children}</Text>
    </View>
  );
}

/** A tappable line in a list of settings, with a chevron. */
export function Row({ title, subtitle, right, onPress, tint, first, last }: {
  title: ReactNode; subtitle?: ReactNode; right?: ReactNode; onPress?: () => void; tint?: string; first?: boolean; last?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        backgroundColor: pressed && onPress ? t.panel2 : t.panel,
        paddingHorizontal: space.lg,
        paddingVertical: 13,
        borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
        borderTopColor: t.line2,
        borderTopLeftRadius: first ? radius.lg : 0,
        borderTopRightRadius: first ? radius.lg : 0,
        borderBottomLeftRadius: last ? radius.lg : 0,
        borderBottomRightRadius: last ? radius.lg : 0,
      })}
    >
      {tint ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: tint }} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        {typeof title === "string" ? <Text style={{ color: t.ink, fontSize: 15, fontWeight: "600" }}>{title}</Text> : title}
        {typeof subtitle === "string" ? <Text style={{ color: t.ink3, fontSize: 13 }} numberOfLines={2}>{subtitle}</Text> : subtitle}
      </View>
      {right}
      {onPress ? <Text style={{ color: t.ink4, fontSize: 20, marginTop: -2 }}>›</Text> : null}
    </Pressable>
  );
}

/** A group of rows as one rounded block. */
export function Rows({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: t.line, overflow: "hidden" }}>
      {children}
    </View>
  );
}

export function Avatar({ name, email, size = 38 }: { name: string; email: string; size?: number }) {
  const t = useTheme();
  const { initials, personColorOf } = avatarBits(name, email);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: personColorOf, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: "#fff", fontWeight: "700", fontSize: size * 0.36 }}>{initials}</Text>
      <View style={{ position: "absolute", inset: 0, borderRadius: size / 2, borderWidth: StyleSheet.hairlineWidth, borderColor: t.dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.06)" }} />
    </View>
  );
}

function avatarBits(name: string, email: string) {
  const parts = name.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  const initials = !parts.length ? "?" : (parts.length === 1 ? parts[0]!.slice(0, 2) : parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
  let h = 0;
  for (const c of email.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return { initials, personColorOf: `hsl(${h % 360} 55% 46%)` };
}

export function Loading({ label }: { label?: string }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, padding: space.xl }}>
      <ActivityIndicator color={t.ink3} />
      {label ? <Body dim size={13}>{label}</Body> : null}
    </View>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: "center", justifyContent: "center", gap: space.sm, padding: 40 }}>
      <Text style={{ color: t.ink, fontSize: 16, fontWeight: "600" }}>{title}</Text>
      {children ? <Body dim size={13.5} style={{ textAlign: "center", maxWidth: 300 }}>{children}</Body> : null}
      {action}
    </View>
  );
}

/** Something went wrong, said once, in place. */
export function Notice({ children, tone = "warn" }: { children: ReactNode; tone?: "warn" | "error" | "ok" | "brand" }) {
  const t = useTheme();
  const tones = { warn: [t.warnSoft, t.warn], error: [t.errorSoft, t.error], ok: [t.okSoft, t.ok], brand: [t.brandSoft, t.brandInk] }[tone];
  return (
    <View style={{ backgroundColor: tones[0], borderRadius: radius.md, padding: space.md }}>
      <Text style={{ color: tones[1], fontSize: 13.5, lineHeight: 19 }}>{children}</Text>
    </View>
  );
}

export function Divider() {
  const t = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.line }} />;
}

/** A row of choices, like the web app's segmented control. */
export function Segmented<T extends string>({ value, options, onChange }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", backgroundColor: t.sunken, borderRadius: radius.md, padding: 3, gap: 3 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={{ flex: 1, paddingVertical: 7, borderRadius: radius.sm, backgroundColor: on ? t.panel : "transparent", alignItems: "center" }}
          >
            <Text style={{ color: on ? t.ink : t.ink3, fontSize: 13.5, fontWeight: on ? "600" : "500" }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
