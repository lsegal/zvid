// Small HTML helpers shared by the overview and the guide pages.

export const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ] ?? char,
  );

// Escapes `text`, then renders **bold**, `code`, [label](href) and ⌘-style
// key names written as [[Key]]. Guide copy is authored here, never by users.
export function inline(text: string): string {
  return escapeHtml(text)
    .replace(/\[\[([^\]]+)\]\]/g, "<kbd>$1</kbd>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
}

export function el<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing ${selector}`);
  return found;
}

// The docs live under help/ on the site; their pages, screenshots and clips
// are all relative to this.
export const BASE = `${import.meta.env.BASE_URL}help/`;

export const APP_URL = import.meta.env.VITE_APP_URL;
