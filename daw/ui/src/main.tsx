import "./App.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { Client, hostConfig } from "./ipc/client.ts";

const root = document.getElementById("root");
if (!root) {
  throw new Error('Missing root element with id "root".');
}

/**
 * The plugin's or harness's client, or in the Vite dev server without
 * either, the web driver's (see src/web/driver.ts).
 */
async function connect(): Promise<Client | undefined> {
  const config = hostConfig();
  if (config) return new Client(config);
  if (import.meta.env.DEV) {
    const { startWebDriver } = await import("./web/start.ts");
    return startWebDriver(window.location.search);
  }
  return undefined;
}

void connect().then((client) =>
  createRoot(root).render(
    <StrictMode>
      {client ? (
        <App client={client} />
      ) : (
        <p className="no-host">
          Open this page from the plugin or the harness, or run{" "}
          <code>pnpm --dir daw/ui dev</code> to use the web driver.
        </p>
      )}
    </StrictMode>,
  ),
);
