export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import InstellingenClient from "./instellingen-client";

export default async function InstellingenPage() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  if (!user) redirect("/kind/login");

  return <InstellingenClient />;
}
