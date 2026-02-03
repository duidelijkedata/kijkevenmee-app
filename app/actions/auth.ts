// BUILD_MARKER_888246c
"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

type Role = "ouder" | "kind";

async function getOrigin() {
  const h = await headers(); // Next 15: headers() returns Promise
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  if (!host) return "http://localhost:3000";
  return `${proto}://${host}`;
}

function normalizeUsername(username: string) {
  return username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
}

function safeNext(next: string | null) {
  if (!next) return null;
  if (!next.startsWith("/")) return null;
  if (next.startsWith("//")) return null;
  return next;
}

export async function signUpEmailUsernamePassword(formData: FormData) {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const usernameRaw = String(formData.get("username") || "");
  const password = String(formData.get("password") || "");
  const role = (String(formData.get("role") || "kind") as Role) || "kind";

  const username = normalizeUsername(usernameRaw);

  if (!email.includes("@")) return { ok: false, error: "Vul een geldig e-mailadres in." };
  if (username.length < 3) return { ok: false, error: "Loginnaam moet minimaal 3 tekens zijn." };
  if (password.length < 8) return { ok: false, error: "Wachtwoord moet minimaal 8 tekens zijn." };
  if (role !== "ouder" && role !== "kind") return { ok: false, error: "Ongeldig profieltype." };

  const admin = supabaseAdmin();
  const { data: existing, error: exErr } = await admin
    .from("profiles")
    .select("id")
    .eq("username", username)
    .limit(1);

  if (exErr) return { ok: false, error: exErr.message };
  if (existing && existing.length > 0) return { ok: false, error: "Loginnaam is al in gebruik." };

  const origin = await getOrigin();
  const confirmRedirectTo = `${origin}/auth/confirm`;

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: confirmRedirectTo,
      data: { username, role },
    },
  });

  if (error) return { ok: false, error: error.message };

  redirect(`/login?check_email=1&email=${encodeURIComponent(email)}`);
}

export async function signInWithUsernamePassword(formData: FormData) {
  const usernameRaw = String(formData.get("username") || "");
  const password = String(formData.get("password") || "");
  const next = safeNext(String(formData.get("next") || "")) ?? null;

  const username = normalizeUsername(usernameRaw);
  if (!username || !password) return { ok: false, error: "Vul loginnaam en wachtwoord in." };

  const admin = supabaseAdmin();
  const { data: profile, error: pErr } = await admin
    .from("profiles")
    .select("email, role")
    .eq("username", username)
    .single();

  if (pErr || !profile?.email) {
    return { ok: false, error: "Onjuiste loginnaam of wachtwoord." };
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({
    email: profile.email,
    password,
  });

  if (error) return { ok: false, error: "Onjuiste loginnaam of wachtwoord." };

  if (next) redirect(next);
  redirect(profile.role === "ouder" ? "/ouder" : "/kind");
}

export async function signOut() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect("/");
}
