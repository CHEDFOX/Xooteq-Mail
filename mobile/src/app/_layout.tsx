// The app's frame: who is signed in decides what exists. Everything under
// (app) needs a session; sign-in is what is left when there is none.
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { useColorScheme } from "react-native";
import { SessionProvider, useSession } from "@/lib/session";

SplashScreen.preventAutoHideAsync();

function Navigator() {
  const { starting, me } = useSession();
  const scheme = useColorScheme();

  useEffect(() => {
    // The splash stays until it is known whether this device is signed in, so
    // nobody sees the sign-in screen for an instant on the way to their mail.
    if (!starting) SplashScreen.hideAsync().catch(() => {});
  }, [starting]);

  if (starting) return null;
  return (
    <ThemeProvider value={scheme === "dark" ? DarkTheme : DefaultTheme}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerBackButtonDisplayMode: "minimal" }}>
        <Stack.Protected guard={!!me}>
          <Stack.Screen name="(app)" options={{ headerShown: false }} />
          <Stack.Screen name="thread/[cid]/[id]" options={{ title: "" }} />
          <Stack.Screen name="compose" options={{ presentation: "modal", title: "New message" }} />
          <Stack.Screen name="company/[cid]" options={{ title: "Company" }} />
          <Stack.Screen name="form/[cid]/[id]" options={{ title: "Form" }} />
          <Stack.Screen name="form/new" options={{ presentation: "modal", title: "Connect a form" }} />
          <Stack.Screen name="sending/[id]" options={{ title: "App" }} />
          <Stack.Screen name="activity" options={{ title: "AI activity" }} />
          <Stack.Screen name="devices" options={{ title: "Devices" }} />
        </Stack.Protected>
        <Stack.Protected guard={!me}>
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}

export default function Root() {
  return (
    <SessionProvider>
      <Navigator />
    </SessionProvider>
  );
}
