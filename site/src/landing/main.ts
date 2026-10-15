import "@zvid/tokens/tokens.css";
import "./style.css";
import { features, homes } from "./slides";

const BASE = import.meta.env.BASE_URL;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ] ?? char,
  );

function el<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing ${selector}`);
  return found;
}

function renderFeatures() {
  el("#feature-slides").outerHTML = features
    .map(
      (slide, index) => `
    <section id="${slide.id}" class="slide slide--feature${index % 2 ? " slide--flip" : ""}" data-accent="${slide.accent}" aria-labelledby="${slide.id}-title">
      <div class="feature-copy">
        <p class="kicker reveal"><span class="kicker-num">${String(index + 1).padStart(2, "0")}</span>${escapeHtml(slide.kicker)}</p>
        <h2 id="${slide.id}-title" class="reveal">${escapeHtml(slide.title)}</h2>
        <p class="body reveal">${escapeHtml(slide.body)}</p>
        <ul class="chips reveal">${slide.chips.map((chip) => `<li>${escapeHtml(chip)}</li>`).join("")}</ul>
        <a class="text-link reveal" href="${BASE}help/${slide.guide}/">Learn more <span aria-hidden="true">→</span></a>
      </div>
      <div class="feature-media reveal">
        <video data-video="${slide.video}" muted loop playsinline preload="none" aria-label="${escapeHtml(slide.title)}"></video>
      </div>
    </section>`,
    )
    .join("");
}

function renderHomes() {
  el("#homes").innerHTML = homes
    .map(
      (home, index) => `
      <li class="home reveal" style="--i:${index}">
        <strong>${escapeHtml(home.app)}</strong>
        <span>${escapeHtml(home.note)}</span>
      </li>`,
    )
    .join("");
}

// Videos get their URLs here so they pick up the /landing/ base.
function wireVideos() {
  for (const video of document.querySelectorAll<HTMLVideoElement>(
    "video[data-video]",
  )) {
    const name = video.dataset.video;
    video.poster = `${BASE}videos/${name}.jpg`;
    video.src = `${BASE}videos/${name}.mp4`;
    if (reduceMotion) video.controls = !video.classList.contains("hero-video");
  }
}

function renderDots(slides: HTMLElement[]) {
  el(".dots").innerHTML = slides
    .map((slide, index) => {
      const label =
        slide
          .querySelector("h1, h2")
          ?.textContent?.replace(/\s+/g, " ")
          .trim() ?? `Slide ${index + 1}`;
      return `<a href="#${slide.id}" data-accent="${slide.dataset.accent}" aria-label="${escapeHtml(label)}"><span></span></a>`;
    })
    .join("");
  el("#counter-total").textContent = String(slides.length).padStart(2, "0");
}

// The slide most in view is active: its copy animates in, its video plays,
// and the dots and counter follow it.
function setUpActiveSlide(slides: HTMLElement[]) {
  const dots = [...document.querySelectorAll<HTMLAnchorElement>(".dots a")];
  const counter = el("#counter-now");
  const ratios = new Map<Element, number>();
  let active: HTMLElement | undefined;

  const activate = (slide: HTMLElement) => {
    if (slide === active) return;
    active?.classList.remove("is-active");
    active?.querySelector("video")?.pause();
    active = slide;
    slide.classList.add("is-active");
    slide.classList.add("was-seen");
    const video = slide.querySelector("video");
    if (video && !reduceMotion) video.play().catch(() => {});
    const index = slides.indexOf(slide);
    dots.forEach((dot, dotIndex) => {
      if (dotIndex === index) dot.setAttribute("aria-current", "true");
      else dot.removeAttribute("aria-current");
    });
    counter.textContent = String(index + 1).padStart(2, "0");
    document.body.dataset.accent = slide.dataset.accent;
  };

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries)
        ratios.set(entry.target, entry.intersectionRatio);
      let best: HTMLElement | undefined;
      let bestRatio = 0;
      for (const slide of slides) {
        const ratio = ratios.get(slide) ?? 0;
        if (ratio > bestRatio) {
          best = slide;
          bestRatio = ratio;
        }
      }
      if (best && bestRatio > 0.35) activate(best);
    },
    { threshold: [0, 0.2, 0.35, 0.5, 0.65, 0.8, 1] },
  );
  for (const slide of slides) observer.observe(slide);
}

function setUpProgress() {
  const bar = el(".progress span");
  const update = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${max > 0 ? scrollY / max : 0})`;
  };
  addEventListener("scroll", update, { passive: true });
  addEventListener("resize", update);
  update();
}

// J and K step between slides, like a deck.
function setUpKeys(slides: HTMLElement[]) {
  addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if ((event.target as HTMLElement).closest("input, textarea")) return;
    const step = event.key === "j" ? 1 : event.key === "k" ? -1 : 0;
    if (!step) return;
    const current = slides.findIndex((slide) =>
      slide.classList.contains("is-active"),
    );
    const next =
      slides[Math.min(slides.length - 1, Math.max(0, current + step))];
    next?.scrollIntoView({ behavior: reduceMotion ? "instant" : "smooth" });
  });
}

renderFeatures();
renderHomes();
el(".cta-mark").innerHTML = el(".brand svg").innerHTML;
el("#year").textContent = String(new Date().getFullYear());
wireVideos();
const slides = [...document.querySelectorAll<HTMLElement>(".slide")];
renderDots(slides);
setUpActiveSlide(slides);
setUpProgress();
setUpKeys(slides);
