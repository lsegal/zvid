import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { installHarness } from "./harness";
import { ZVID_VERSION } from "./version";

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
      <App />
    </StrictMode>,
  );
}

void bootstrap();
