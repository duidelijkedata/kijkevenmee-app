import { Suspense } from "react";
import AuthCallbackClient from "./auth-callback-client";

export default function Page() {
  return (
    <Suspense
      fallback={
        <main style={{ maxWidth: 720, margin: "40px auto", fontFamily: "system-ui", padding: "0 16px" }}>
          <h1 style={{ fontSize: 22, margin: "0 0 8px 0" }}>Inloggen</h1>
          <p style={{ color: "#475569", margin: 0 }}>Bezig met inloggen…</p>
        </main>
      }
    >
      <AuthCallbackClient />
    </Suspense>
  );
}
