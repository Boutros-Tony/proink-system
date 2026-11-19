import { redirect } from "next/navigation";
import Studio from "@/components/workspace/studio";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const { data: profile } = await supabase.from("studio_profiles").select("id").eq("id", data.user.id).maybeSingle();
  if (!profile) redirect("/login?error=no-access");
  return <Studio />;
}
