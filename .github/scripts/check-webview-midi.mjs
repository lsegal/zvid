// Asks the running desktop app's webview for Web MIDI over the DevTools
// protocol and fails unless the call resolves. A call that stays pending means
// WebView2's permission prompt is showing. Usage: check-webview-midi.mjs PORT
const port = process.argv[2];
const REQUEST = `Promise.race([
  navigator.requestMIDIAccess().then(() => "resolved", (error) => "rejected: " + error.name),
  new Promise((resolve) => setTimeout(() => resolve("still pending"), 15000)),
])`;

async function findPage() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find((target) => target.type === "page" && target.url.startsWith("http://tauri.localhost"));
      if (page) return page;
    } catch {
      // The webview hasn't opened its debugging port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("the app's page never appeared");
}

function evaluate(page, expression) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    socket.onerror = () => reject(new Error("the DevTools connection failed"));
    socket.onopen = () => {
      socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true } }));
    };
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.id !== 1) return;
      socket.close();
      resolve(message.result?.result?.value ?? JSON.stringify(message));
    };
  });
}

const result = await evaluate(await findPage(), REQUEST);
console.log(`requestMIDIAccess: ${result}`);
if (result !== "resolved") process.exit(1);
