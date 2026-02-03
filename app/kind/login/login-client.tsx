"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LoginClient() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/login?next=/kind");
  }, [router]);

  return null;
}
