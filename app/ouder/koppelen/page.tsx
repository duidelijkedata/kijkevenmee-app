import { Suspense } from "react";
import KoppelenClient from "./koppelen-client";

export default function Page() {
  return (
    <Suspense
      fallback={
        <main style={{ maxWidth: 720, margin: "40px auto", fontFamily: "system-ui", padding: "0 16px" }}>
          <h1 style={{ fontSize: 22, margin: "0 0 8px 0" }}>Koppelen</h1>
          <p style={{ color: "#475569", margin: 0 }}>Laden…</p>
        </main>
      }
    >
      <KoppelenClient />
    </Suspense>
  );
}
