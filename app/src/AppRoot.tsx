import { useEffect, useState } from "react";
import App from "./App.tsx";
import { bootWorkspace } from "./app/workspace-boot.ts";
import type { WorkspaceBoot } from "./app/workspace-types.ts";

// Loads the saved session before the editor renders, so the timeline never
// flashes empty before a restore.
function AppRoot() {
  const [boot, setBoot] = useState<WorkspaceBoot | null>(null);

  useEffect(() => {
    let active = true;
    void bootWorkspace().then((result) => {
      if (active) {
        setBoot(result);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  if (!boot) {
    return <output className="workspace-restoring">Restoring session…</output>;
  }
  return <App boot={boot} />;
}

export default AppRoot;
