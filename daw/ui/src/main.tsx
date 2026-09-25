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
