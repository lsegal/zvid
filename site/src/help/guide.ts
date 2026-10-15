// Entry point for the guide pages at help/<id>/. Each page's HTML names its
// guide in <body data-guide>; everything else renders from src/guides.
import "@zvid/tokens/tokens.css";
import "./style.css";
import "./guide.css";
import { jumpToHash, setUpMenu, setUpScrollSpy } from "./chrome";
import { demos } from "./content";
import { guides } from "./guides";
import { SHOT_SIZES } from "./guides/shot-sizes";
import type { Block, Guide } from "./guides/types";
import { APP_URL, BASE, el, escapeHtml, inline } from "./html";

const BRAND_PATHS = `
  <path fill-rule="evenodd" d="M 2,48 C 6,26 22,2 46,2 H 204 C 219,2 230,11 230,25 V 40 C 230,48 225,54 217,58 C 220,52 213,50 202,50 H 5 Q 1,50 2,48 Z M 51,26 m -9,0 a 9,9 0 1,0 18,0 a 9,9 0 1,0 -18,0 Z M 91,26 m -10,0 a 10,10 0 1,0 20,0 a 10,10 0 1,0 -20,0 Z M 133,26 m -11,0 a 11,11 0 1,0 22,0 a 11,11 0 1,0 -22,0 Z M 175,26 m -11,0 a 11,11 0 1,0 22,0 a 11,11 0 1,0 -22,0 Z" />
  <path d="M 119,57 H 213 L 109,137 H 17 Q 9,137 5,142 Z" />
  <path fill-rule="evenodd" d="M 4,144 C 8,140 15,145 26,145 H 236 Q 241,145 240,149 C 234,171 221,194 198,194 H 25 C 10,194 2,185 2,173 V 157 Q 2,149 4,144 Z M 78,169 m -11,0 a 11,11 0 1,0 22,0 a 11,11 0 1,0 -22,0 Z M 121,169 m -11,0 a 11,11 0 1,0 22,0 a 11,11 0 1,0 -22,0 Z M 163,169 m -10,0 a 10,10 0 1,0 20,0 a 10,10 0 1,0 -20,0 Z M 203,169 m -9,0 a 9,9 0 1,0 18,0 a 9,9 0 1,0 -18,0 Z" />`;

const guideUrl = (id: string) => `${BASE}${id}/`;

function renderSidebar(guide: Guide) {
  el(".sidebar").innerHTML = `
    <div class="sidebar-top">
      <a class="brand" href="${BASE}" aria-label="zvid Help home">
        <svg viewBox="-8 -8 258 212" aria-hidden="true">${BRAND_PATHS}</svg>
        <span>zvid</span><span class="brand-tag">help</span>
      </a>
      <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="sidebar-body">Contents</button>
    </div>
    <div id="sidebar-body" class="sidebar-body">
      <a class="back-link" href="${BASE}"><span aria-hidden="true">←</span> Help overview</a>
      <nav class="toc" aria-label="Contents">
        <p class="toc-label">On this page</p>
        <ol>${guide.sections
          .map(
            (section) =>
              `<li><a href="#${section.id}">${escapeHtml(section.title)}</a></li>`,
          )
          .join("")}</ol>
        <p class="toc-label">Guides</p>
        <ol>${guides
          .map(
            (item) =>
              `<li><a href="${guideUrl(item.id)}" data-accent="${item.accent}"${
                item.id === guide.id ? ' aria-current="page"' : ""
              }><span class="swatch"></span>${escapeHtml(item.title)}</a></li>`,
          )
          .join("")}</ol>
      </nav>
      <a class="open-app" href="${APP_URL}">Open zvid <span aria-hidden="true">→</span></a>
    </div>`;
}

function renderBlock(block: Block): string {
  switch (block.type) {
    case "p":
      return `<p>${inline(block.text)}</p>`;
    case "h3":
      return `<h3>${inline(block.text)}</h3>`;
    case "list":
      return `<ul class="g-list">${block.items.map((item) => `<li>${inline(item)}</li>`).join("")}</ul>`;
    case "steps":
      return `<ol class="g-steps">${block.items.map((item) => `<li>${inline(item)}</li>`).join("")}</ol>`;
    case "note":
      return `<aside class="g-note g-note--${block.tone ?? "note"}"><span class="g-note-label">${
        block.tone === "tip" ? "Tip" : "Note"
      }</span><p>${inline(block.text)}</p></aside>`;
    case "table":
      return `<div class="g-table-wrap"><table class="g-table${block.compact ? " g-table--compact" : ""}">
        <thead><tr>${block.head.map((cell) => `<th scope="col">${inline(cell)}</th>`).join("")}</tr></thead>
        <tbody>${block.rows
          .map(
            (row) =>
              `<tr>${row.map((cell) => `<td>${inline(cell).split(" · ").join("<br />")}</td>`).join("")}</tr>`,
          )
          .join("")}</tbody>
      </table></div>`;
    case "figure": {
      // Shots are captured at 2x, so their natural CSS width is half their
      // pixel width; never stretch them past it.
      const dims = SHOT_SIZES[block.shot];
      const maxWidth = Math.min(
        block.width ?? Infinity,
        dims ? dims[0] / 2 : Infinity,
      );
      const width = Number.isFinite(maxWidth)
        ? ` style="max-width:${maxWidth}px"`
        : "";
      const size = dims ? ` width="${dims[0]}" height="${dims[1]}"` : "";
      return `<figure class="g-figure"${width}>
        <img src="${BASE}shots/${block.shot}.webp"${size} alt="${escapeHtml(block.alt)}" loading="lazy" decoding="async" />
        ${block.caption ? `<figcaption>${inline(block.caption)}</figcaption>` : ""}
      </figure>`;
    }
    case "video": {
      const demo = demos.find((item) => item.id === block.id);
      if (!demo) return "";
      return `<figure class="g-figure g-video">
        <video src="${BASE}videos/${demo.id}.mp4" poster="${BASE}videos/${demo.id}.jpg" width="${demo.width}" height="${demo.height}" muted loop playsinline preload="none" aria-label="${escapeHtml(demo.title)}"></video>
        <figcaption>${inline(block.caption ?? demo.body)}</figcaption>
      </figure>`;
    }
    case "keys":
      return `<dl class="keys g-keys">${block.rows
        .map(
          (row) => `<div class="key-row">
            <dt>${row.keys.map((key) => `<kbd>${escapeHtml(key)}</kbd>`).join("")}</dt>
            <dd>${inline(row.action)}</dd>
          </div>`,
        )
        .join("")}</dl>`;
  }
}

function renderGuide(guide: Guide) {
  const index = guides.indexOf(guide);
  const previous = guides[index - 1];
  const next = guides[index + 1];
  el("#main").innerHTML = `
    <header class="intro guide-intro" data-accent="${guide.accent}">
      <div class="ruler" aria-hidden="true">
        <span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span><span>7</span><span>8</span>
      </div>
      <p class="kicker"><a href="${BASE}">Help</a> · Guide ${String(index + 1).padStart(2, "0")}</p>
      <h1>${escapeHtml(guide.title)}</h1>
      <p class="lede">${inline(guide.summary)}</p>
    </header>
    ${guide.sections
      .map(
        (section, sectionIndex) => `
      <section id="${section.id}" class="block guide-section" data-accent="${guide.accent}" aria-labelledby="${section.id}-heading">
        <h2 id="${section.id}-heading" class="block-title"><span class="num">${String(sectionIndex + 1).padStart(2, "0")}</span>${escapeHtml(section.title)}</h2>
        <div class="prose">${section.blocks.map(renderBlock).join("")}</div>
      </section>`,
      )
      .join("")}
    <nav class="pager" aria-label="More guides">
      ${previous ? `<a class="pager-link" href="${guideUrl(previous.id)}" data-accent="${previous.accent}"><span>Previous</span>${escapeHtml(previous.title)}</a>` : "<span></span>"}
      ${next ? `<a class="pager-link pager-link--next" href="${guideUrl(next.id)}" data-accent="${next.accent}"><span>Next</span>${escapeHtml(next.title)}</a>` : ""}
    </nav>
    <footer class="footer">
      <p>© ${new Date().getFullYear()} zvid</p>
    </footer>`;
}

// Videos play muted on a loop while they're on screen.
function setUpVideos() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    for (const video of document.querySelectorAll("video"))
      video.controls = true;
    return;
  }
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
  for (const video of document.querySelectorAll("video"))
    observer.observe(video);
}

const guide = guides.find((item) => item.id === document.body.dataset.guide);
if (guide) {
  document.title = `${guide.title} · zvid Help`;
  renderSidebar(guide);
  renderGuide(guide);
  setUpMenu();
  setUpScrollSpy();
  setUpVideos();
  jumpToHash();
}
