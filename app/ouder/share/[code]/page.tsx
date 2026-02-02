import { Suspense } from "react";
import ShareClient from "./share-client";

export default async function Page(props: { params: Promise<{ code: string }> }) {
  const { code } = await props.params;

  return (
    <Suspense
      fallback={
        <main style={{ maxWidth: 900, margin: "40px auto", fontFamily: "system-ui", padding: "0 16px" }}>
          <h1 style={{ fontSize: 22, margin: "0 0 8px 0" }}>Scherm delen</h1>
          <p style={{ color: "#475569", margin: 0 }}>Laden…</p>
        </main>
      }
    >
      <ShareClient code={code} />
    </Suspense>
  );
}
