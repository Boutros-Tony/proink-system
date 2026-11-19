import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SettingsShell } from "@/components/settings/settings-shell";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Settings · ProInk",
};

export default async function SettingsLayout({ children }: LayoutProps<"/settings">) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  return <SettingsShell>{children}</SettingsShell>;
}
