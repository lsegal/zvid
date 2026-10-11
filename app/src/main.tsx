import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./text-fonts.css";
import AppRoot from "./AppRoot.tsx";
import { installHarness } from "./harness";
import { ZVID_VERSION } from "./version";

// iOS home screen apps report themselves through navigator.standalone; mark
// the root before the first render so the top bar hides its brand mark (#1200).
if ((navigator as Navigator & { standalone?: boolean }).standalone) {
  document.documentElement.classList.add("installed-app");
}

async function bootstrap() {
  console.info(
    `zvid ${ZVID_VERSION} ${__APP_COMMIT__} (${__APP_BUILD_TIME__})`,
  );
  await installHarness();

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
