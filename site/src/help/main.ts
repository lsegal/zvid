import "@zvid/tokens/tokens.css";
import "./style.css";
import "./guide.css";
import { jumpToHash, setUpMenu, setUpScrollSpy } from "./chrome";
import {
  demos,
  formats,
  highlights,
  quickStart,
  shortcuts,
  switchers,
  topics,
} from "./content";
import { BASE, el, escapeHtml } from "./html";

const sectionNumber = (index: number) => String(index + 1).padStart(2, "0");

function renderHighlights() {
  el("#highlights").innerHTML = highlights
    .map(
      (item, index) => `
      <li class="lane" data-accent="${item.accent}">
        <span class="lane-head">Track ${index + 1}</span>
        <div class="lane-body">
          <h2>${escapeHtml(item.title)}</h2>
          <p>${escapeHtml(item.body)}</p>
        </div>
      </li>`,
    )
    .join("");
}

// Clips play muted on a loop while they're on screen and pause off screen.
// With reduced motion they wait for the viewer, who gets the controls.
function renderDemos() {
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const base = `${BASE}videos/`;
  el("#demos").innerHTML = demos
    .map(
      (demo) => `
      <figure class="demo">
        <video src="${base}${demo.id}.mp4" poster="${base}${demo.id}.jpg" width="${demo.width}" height="${demo.height}" muted loop playsinline preload="none"${reduceMotion ? " controls" : ""} aria-label="${escapeHtml(demo.title)}"></video>
        <figcaption>
          <h3>${escapeHtml(demo.title)}</h3>
          <p>${escapeHtml(demo.body)}</p>
        </figcaption>
      </figure>`,
    )
    .join("");
  if (reduceMotion) return;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const video = entry.target as HTMLVideoElement;
        if (entry.isIntersecting) video.play().catch(() => {});
        else video.pause();
      }
    },
    { threshold: 0.4 },
  );
  for (const video of document.querySelectorAll<HTMLVideoElement>(
    ".demo video",
  )) {
    observer.observe(video);
  }
}

// Each path is its own ruler of four cues.
function renderQuickStart() {
  el("#quick-start-paths").innerHTML = quickStart
    .map(
      (path) => `
      <section class="path" aria-labelledby="path-${path.id}">
        <h3 id="path-${path.id}" class="path-title">${escapeHtml(path.title)}</h3>
        <ol class="track">${path.steps
          .map(
            (step, index) => `
          <li class="cue">
            <span class="cue-marker">${index + 1}.1.1</span>
            <h4>${escapeHtml(step.title)}</h4>
            <p>${escapeHtml(step.body)}</p>
          </li>`,
          )
          .join("")}
        </ol>
      </section>`,
    )
    .join("");
}

function renderTopics() {
  el("#toc-topics").innerHTML = topics
    .map(
      (topic) =>
        `<li data-topic="${topic.id}"><a href="#${topic.id}" data-accent="${topic.accent}"><span class="swatch"></span>${escapeHtml(topic.title)}</a></li>`,
    )
    .join("");

  el("#topics").innerHTML = topics
    .map(
      (topic, index) => `
      <section class="block topic" id="${topic.id}" data-accent="${topic.accent}" data-header="${escapeHtml(
        `${topic.title} ${topic.summary}`.toLowerCase(),
      )}" aria-labelledby="${topic.id}-heading">
        <h2 id="${topic.id}-heading" class="block-title"><span class="num">${sectionNumber(index)}</span>${escapeHtml(topic.title)}</h2>
        <p class="block-lede">${escapeHtml(topic.summary)}</p>
        <div class="rows">
          ${topic.groups
            .map(
              (group) => `
            <div class="row" data-search="${escapeHtml(
              [group.title, ...group.items].join(" ").toLowerCase(),
            )}">
              <h3>${escapeHtml(group.title)}</h3>
              <ul>${group.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
            </div>`,
            )
            .join("")}
        </div>
        <a class="guide-link" href="${BASE}${topic.id}/">Read the full ${escapeHtml(topic.title)} guide <span aria-hidden="true">→</span></a>
      </section>`,
    )
    .join("");
}

function setUpSearch() {
  const input = el<HTMLInputElement>("#search");
  const status = el("#search-status");
  const noResults = el("#no-results");
  const apply = () => {
    const terms = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (text: string) =>
      terms.every((term) => text.includes(term));
    let shown = 0;
    for (const topic of document.querySelectorAll<HTMLElement>(".topic")) {
      // Terms may be split between the topic's heading and a row, so each row
      // is matched together with its topic's title and summary.
      const header = topic.dataset.header ?? "";
      let rowsShown = 0;
      for (const row of topic.querySelectorAll<HTMLElement>(".row")) {
        const hit = matches(`${header} ${row.dataset.search ?? ""}`);
        row.hidden = !hit;
        if (hit) rowsShown++;
      }
      topic.hidden = rowsShown === 0;
      document
        .querySelector(`[data-topic="${topic.id}"]`)
        ?.classList.toggle("is-dimmed", rowsShown === 0);
      if (rowsShown > 0) shown++;
    }
    noResults.hidden = terms.length === 0 || shown > 0;
    status.textContent =
      terms.length === 0 ? "" : `${shown} of ${topics.length} feature sections`;
  };
  input.addEventListener("input", apply);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      input.value = "";
      apply();
    }
  });
  document.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement;
    if (event.key !== "/" || target.closest("input, textarea")) return;
    event.preventDefault();
    input.focus();
  });
}

function renderSwitchers() {
  el("#switchers").innerHTML = switchers
    .map(
      (item, index) => `
      <details class="switcher"${index === 0 ? " open" : ""}>
        <summary><span class="switcher-app">${escapeHtml(item.app)}</span><span class="switcher-intro">${escapeHtml(item.intro)}</span></summary>
        <table>
          <thead><tr><th scope="col">In ${escapeHtml(item.app)}</th><th scope="col">In zvid</th></tr></thead>
          <tbody>${item.rows
            .map(
              (row) =>
                `<tr><td>${escapeHtml(row.known)}</td><td>${escapeHtml(row.zvid)}</td></tr>`,
            )
            .join("")}</tbody>
        </table>
      </details>`,
    )
    .join("");
}

function renderShortcuts() {
  el("#shortcut-list").innerHTML = shortcuts
    .map(
      (shortcut) => `
      <div class="key-row">
        <dt>${shortcut.keys.map((key) => `<kbd>${escapeHtml(key)}</kbd>`).join("")}</dt>
        <dd>${escapeHtml(shortcut.action)}</dd>
      </div>`,
    )
    .join("");
}

function renderFormats() {
  el("#format-list").innerHTML = formats
    .map(
      (format) => `
      <section class="format">
        <h3>${escapeHtml(format.title)}</h3>
        <ul>${format.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </section>`,
    )
    .join("");
}

renderHighlights();
renderQuickStart();
renderDemos();
renderTopics();
setUpSearch();
renderSwitchers();
renderShortcuts();
renderFormats();
setUpMenu();
setUpScrollSpy();
el("#year").textContent = String(new Date().getFullYear());

jumpToHash();
