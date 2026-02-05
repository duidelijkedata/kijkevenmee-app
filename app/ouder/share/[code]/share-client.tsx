import { Suspense } from "react";
import ShareClient from "./share-client";

export default async function Page(props: { params: Promise<{ code: string }> }) {
  const { code } = await props.params;

  return (
    <Suspense
      fallback={
        <div className="h-screen w-screen flex items-center justify-center bg-black text-white">
          Laden…
        </div>
      }
    >
      <ShareClient code={code} />
    </Suspense>
  );
}
