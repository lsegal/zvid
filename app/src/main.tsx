import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./text-fonts.css";
import AppRoot from "./AppRoot.tsx";
import { startAgentRelay } from "./agent-relay";
import { installHarness } from "./harness";
import { markInstalledApp } from "./installed-app.ts";
import { ZVID_VERSION } from "./version";

markInstalledApp();

async function bootstrap() {
  console.info(
    `zvid ${ZVID_VERSION} ${__APP_COMMIT__} (${__APP_BUILD_TIME__})`,
  );
  await installHarness();
  startAgentRelay().catch((error) =>
    console.warn("zvid: the agent relay could not start", error),
  );

  const rootElement = document.getElementById("root");
  if (!rootElement) {
    throw new Error('Missing root element with id "root".');
  }

  createRoot(rootElement).render(
    <StrictMode>
      <AppRoot />
    </StrictMode>,
  );
}

void bootstrap();
