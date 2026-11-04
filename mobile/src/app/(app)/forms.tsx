// The contact forms, company by company: what each one is, where it delivers,
// and whether it is on. Tapping one opens its code, its submissions and its test.
import { useCallback, useState } from "react";
import { RefreshControl, ScrollView, Switch, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { get, patch } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import type { ContactForm, FormsPage } from "@/lib/types";
import { space, useTheme } from "@/lib/theme";
import { Body, Button, Empty, Loading, Notice, Row, Rows, Title } from "@/ui/kit";
import { CompanyBar } from "@/ui/company-bar";

export default function FormsScreen() {
  const t = useTheme();
  const { me } = useSession();
  const [cid, setCid] = useState<string | undefined>(undefined);
  const company = me?.companies.find((c) => c.id === cid) ?? me?.companies[0];

  const { data: page, error, busy, refresh, set } = useLoad(
    () => get<FormsPage>(`/api/companies/${encodeURIComponent(company!.id)}/forms`),
    company?.id ?? "",
  );
  // Coming back to the tab (after connecting one, say) shows it as it now is.
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  async function toggle(f: ContactForm, on: boolean) {
    if (page) set({ ...page, forms: page.forms.map((x) => (x.id === f.id ? { ...x, enabled: on } : x)) });
    try {
      await patch(`/api/companies/${encodeURIComponent(company!.id)}/forms/${f.id}`, { enabled: on });
    } catch {
      refresh();
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 48, gap: space.lg }}
        refreshControl={<RefreshControl refreshing={busy} onRefresh={refresh} tintColor={t.ink3} />}
      >
        <View style={{ paddingHorizontal: space.lg, paddingTop: space.sm }}>
          <Title>Forms</Title>
          <Body dim size={13.5}>A site’s contact form, or a message card in an app, delivering to one of these addresses.</Body>
        </View>
        <CompanyBar cid={company?.id} onPick={setCid} />

        <View style={{ paddingHorizontal: space.lg, gap: space.lg }}>
          {error ? <Notice tone="error">{error}</Notice> : null}
          {!page && !error ? <Loading /> : null}
          {page && !page.ready ? <Notice>Forms are not connected to this server yet. Run workspace-setup.sh on it.</Notice> : null}

          {page?.forms.length === 0 ? (
            <Empty title="No forms yet" action={<Button title="Connect a form" variant="primary" onPress={() => router.push({ pathname: "/form/new", params: { cid: company!.id } })} />}>
              Point a site’s form or an app’s message card at one of {company?.name}’s addresses.
            </Empty>
          ) : null}

          {page && page.forms.length > 0 ? (
            <>
              <Rows>
                {page.forms.map((f, i) => (
                  <Row
                    key={f.id}
                    first={i === 0}
                    last={i === page.forms.length - 1}
                    title={f.name}
                    subtitle={`to ${f.email} · ${f.origins.length ? f.origins.join(", ") : "any site"}${f.allowNoOrigin ? ", and apps" : ""}`}
                    right={<Switch value={f.enabled} onValueChange={(on) => toggle(f, on)} />}
                    onPress={() => router.push({ pathname: "/form/[cid]/[id]", params: { cid: company!.id, id: f.id } })}
                  />
                ))}
              </Rows>
              <Button title="Connect a form" onPress={() => router.push({ pathname: "/form/new", params: { cid: company!.id } })} />
            </>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
