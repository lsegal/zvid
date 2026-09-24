// Minimal XML reader for Ableton Live sets. Live writes plain, well-formed
// XML (no DTDs, CDATA or namespaces), so a small tokenizer is enough and lets
// the parser run unchanged in the browser, Tauri and Node tests, where
// DOMParser is not available.

export interface XmlElement {
  name: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  text: string;
}

const TOKEN = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>/g;
const ATTRIBUTE = /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const ENTITY = /&(?:#x([0-9a-fA-F]+)|#(\d+)|(amp|lt|gt|quot|apos));/g;
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeEntities(value: string): string {
  if (!value.includes("&")) return value;
  return value.replace(ENTITY, (_, hex, dec, named) => {
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    if (dec) return String.fromCodePoint(Number.parseInt(dec, 10));
    return NAMED_ENTITIES[named];
  });
}

export function parseXml(source: string): XmlElement {
  const root: XmlElement = {
    name: "#document",
    attributes: {},
    children: [],
    text: "",
  };
  const stack: XmlElement[] = [root];
  let cursor = 0;

  TOKEN.lastIndex = 0;
  for (let match = TOKEN.exec(source); match; match = TOKEN.exec(source)) {
    const current = stack[stack.length - 1];
    if (match.index > cursor) {
      current.text += decodeEntities(source.slice(cursor, match.index));
    }
    cursor = TOKEN.lastIndex;

    const [, closing, name, rawAttributes, selfClosing] = match;
    if (!name) continue; // declaration, comment or doctype

    if (closing) {
      if (current.name !== name || stack.length === 1) {
        throw new Error(`Unexpected </${name}> in XML`);
      }
      current.text = current.text.trim();
      stack.pop();
      continue;
    }

    const attributes: Record<string, string> = {};
    ATTRIBUTE.lastIndex = 0;
    for (
      let attr = ATTRIBUTE.exec(rawAttributes);
      attr;
      attr = ATTRIBUTE.exec(rawAttributes)
    ) {
      attributes[attr[1]] = decodeEntities(attr[2] ?? attr[3]);
    }
    const element: XmlElement = { name, attributes, children: [], text: "" };
    current.children.push(element);
    if (!selfClosing) stack.push(element);
  }

  if (stack.length !== 1) {
    throw new Error(`Unclosed <${stack[stack.length - 1].name}> in XML`);
  }
  const [documentElement] = root.children;
  if (!documentElement) throw new Error("XML document has no root element");
  return documentElement;
}

export function child(
  element: XmlElement | undefined,
  name: string,
): XmlElement | undefined {
  return element?.children.find((candidate) => candidate.name === name);
}

/** Follows a `/`-separated chain of child element names. */
export function at(
  element: XmlElement | undefined,
  path: string,
): XmlElement | undefined {
  let current = element;
  for (const name of path.split("/")) current = child(current, name);
  return current;
}

/** Depth-first search for descendants named `name`, not descending into matches. */
export function findAll(element: XmlElement, name: string): XmlElement[] {
  const found: XmlElement[] = [];
  const visit = (node: XmlElement) => {
    for (const candidate of node.children) {
      if (candidate.name === name) found.push(candidate);
      else visit(candidate);
    }
  };
  visit(element);
  return found;
}
