"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(params.get("error") === "no-access" ? "This account is not on the studio yet. Ask an admin to add it." : null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function enter(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const supabase = createClient();
    const auth = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (auth.error || !auth.data.user) {
      setBusy(false);
      setError(auth.error?.message ?? "Sign-in failed.");
      return;
    }
    if (!auth.data.session) {
      setBusy(false);
      setNotice("Check your email to confirm the account, then sign in.");
      return;
    }
    const { data: profile } = await supabase.from("studio_profiles").select("id").eq("id", auth.data.user.id).maybeSingle();
    if (!profile) {
      await supabase.auth.signOut();
      setBusy(false);
      setError("This account is not on the studio yet. Ask an admin to add it.");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-6 text-ink">
      <form onSubmit={(event) => void enter(event)} className="w-full max-w-sm rounded-2xl border border-line bg-panel p-6 shadow-float">
        <h1 className="text-lg font-semibold tracking-tight">ProInk Studio</h1>
        <p className="mt-1 text-sm text-muted">Sign in to the jobs, prices, and chats.</p>
        <label className="mt-5 block text-xs text-muted">
          Email
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
        </label>
        <label className="mt-3 block text-xs text-muted">
          Password
          <input
            type="password"
            required
            minLength={6}
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
        </label>
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        {notice ? <p className="mt-3 text-sm text-muted">{notice}</p> : null}
        <button type="submit" disabled={busy} className="mt-5 w-full rounded-lg bg-ink px-3 py-2 text-sm font-medium text-bg disabled:opacity-60">
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
