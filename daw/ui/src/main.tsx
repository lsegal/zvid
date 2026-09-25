import "@fontsource/space-grotesk/latin-400.css";
import "@fontsource/space-grotesk/latin-500.css";
import "@fontsource/space-grotesk/latin-600.css";
import "@fontsource/space-grotesk/latin-700.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./App.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { Client, hostConfig } from "./ipc/client.ts";

const root = document.getElementById("root");
if (!root) {
  throw new Error('Missing root element with id "root".');
}

const config = hostConfig();
createRoot(root).render(
  <StrictMode>
    {config ? (
      <App client={new Client(config)} />
    ) : (
      <p className="no-host">
        Open this page from the plugin or the harness:{" "}
        <code>cargo run -p zvid-daw-ui --example harness -- --dev</code>
      </p>
    )}
  </StrictMode>,
);
