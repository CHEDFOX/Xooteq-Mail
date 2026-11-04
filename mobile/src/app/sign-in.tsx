// Signing this device in: the server it belongs to, and the same email and
// password as the dashboard. What comes back is a token of this device's own,
// kept in the phone's secure storage (lib/api.ts).
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import * as Device from "expo-device";
import { SafeAreaView } from "react-native-safe-area-context";
import { cleanServer, OfflineError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { space, useTheme } from "@/lib/theme";
import { Body, Button, Field, Input, Notice, Title } from "@/ui/kit";
import { Mark } from "@/ui/mark";

export default function SignIn() {
  const t = useTheme();
  const { server, signIn } = useSession();
  const [url, setUrl] = useState(server || "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const ready = cleanServer(url).length > 8 && email.includes("@") && password.length > 0;

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      await signIn(cleanServer(url), email.trim(), password, Device.deviceName || `${Device.osName} device`);
    } catch (e) {
      setError(e instanceof OfflineError
        ? `Could not reach ${cleanServer(url)}. Check the address and this phone's connection.`
        : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg, flexGrow: 1, justifyContent: "center" }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: "center", gap: space.md, marginBottom: space.sm }}>
            <Mark size={52} />
            <Title>Xooteq Mail</Title>
            <Body dim size={14} style={{ textAlign: "center" }}>Every company’s mail, on this device.</Body>
          </View>

          <Field label="Your Xooteq Mail address" hint="The address you open in the browser.">
            <Input
              value={url}
              onChangeText={setUrl}
              placeholder="mail.xooteq.online"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              textContentType="URL"
              returnKeyType="next"
            />
          </Field>
          <Field label="Email">
            <Input
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="username"
              returnKeyType="next"
            />
          </Field>
          <Field label="Password">
            <Input
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={submit}
            />
          </Field>

          {error ? <Notice tone="error">{error}</Notice> : null}

          <Button title="Sign in" variant="primary" onPress={submit} busy={busy} disabled={!ready} />
          <Body dim size={12.5} style={{ textAlign: "center" }}>
            This device stays signed in. You can sign it out from any other device under Settings.
          </Body>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
