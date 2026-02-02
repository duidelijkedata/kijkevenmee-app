"use client";

import { useState } from "react";

export default function KindClient({ user }: { user: any }) {
  const [x, setX] = useState(0);

  return (
    <div>
      <div>Ingelogd als: {user?.email ?? "—"}</div>
      <button onClick={() => setX((v) => v + 1)}>Klik {x}</button>
    </div>
  );
}
