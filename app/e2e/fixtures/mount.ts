// Renders one React component on its own in the page, so a spec can test it
// without the rest of the app. Specs import it from the dev server.
import { type ComponentType, createElement } from "react";
import { createRoot } from "react-dom/client";

export function mount<P extends object>(component: ComponentType<P>, props: P) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = (next: P) => root.render(createElement(component, next));
  render(props);
  return { render };
}
