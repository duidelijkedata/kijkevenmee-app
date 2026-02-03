import { Suspense } from "react";
import LoginClient from "./login-client";

export default function Page() {
  return (
    <Suspense
      fallback={
        <main style={{ maxWidth: 520, margin: "40px auto", fontFamily: "system-ui", padding: "0 16px" }}>
          <h1 style={{ fontSize: 22, margin: "0 0 8px 0" }}>Inloggen</h1>
          <p style={{ color: "#475569", marginTop: 0 }}>Laden…</p>
        </main>
      }
    >
      <LoginClient />
    </Suspense>
  );
}
