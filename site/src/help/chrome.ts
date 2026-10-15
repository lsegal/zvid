// Page chrome shared by the overview and the guides: the phone contents
// menu, the contents highlight and deep links.
import { el } from "./html";

export function setUpMenu() {
  const toggle = el<HTMLButtonElement>(".menu-toggle");
  const setOpen = (open: boolean) => {
    toggle.setAttribute("aria-expanded", String(open));
    document.body.classList.toggle("menu-open", open);
  };
  toggle.addEventListener("click", () =>
    setOpen(toggle.getAttribute("aria-expanded") !== "true"),
  );
  el("#sidebar-body").addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("a")) setOpen(false);
  });
}

// Marks the contents entry for the section nearest the top of the view.
export function setUpScrollSpy() {
  const links = new Map(
    [...document.querySelectorAll<HTMLAnchorElement>('.toc a[href^="#"]')].map(
      (link) => [link.hash.slice(1), link],
    ),
  );
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        for (const link of links.values()) link.removeAttribute("aria-current");
        links.get(entry.target.id)?.setAttribute("aria-current", "true");
      }
    },
    { rootMargin: "-10% 0px -80% 0px" },
  );
  for (const id of links.keys()) {
    const section = document.getElementById(id);
    if (section) observer.observe(section);
  }
}

// Sections are filled in by script, so a deep link like /help/#audio has
// nothing to land on until they render.
export function jumpToHash() {
  if (!location.hash) return;
  document
    .getElementById(decodeURIComponent(location.hash.slice(1)))
    ?.scrollIntoView({ behavior: "instant" });
}
