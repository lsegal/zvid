import { cdp } from "vitest/browser";

// Records the phone sheets' motion as it starts (#1211): the motion is over
// in a quarter second, so tests log each animation and transition as it
// begins rather than catching it mid-flight.
export type MotionLog = {
  // "<first class>:<animation or transitioned property>" for each CSS
  // animation or transition that starts.
  motion: string[];
  // Each submenu view transition's direction and pseudo-element animations.
  levelSlides: { nav?: string; animations: string[] }[];
  stop: () => void;
};

export function recordMotion(): MotionLog {
  const log: MotionLog = { motion: [], levelSlides: [], stop: () => {} };
  const push = (element: EventTarget | null, name: string) => {
    const owner = element instanceof Element ? element.classList[0] : "";
    log.motion.push(`${owner}:${name}`);
  };
  const onAnimation = (event: AnimationEvent) =>
    push(event.target, event.animationName);
  const onTransition = (event: TransitionEvent) =>
    push(event.target, event.propertyName);
  document.addEventListener("animationstart", onAnimation);
  document.addEventListener("transitionrun", onTransition);
  const original = document.startViewTransition;
  if (original) {
    const start = original.bind(document);
    document.startViewTransition = ((update: ViewTransitionUpdateCallback) => {
      const transition = start(update);
      void transition.ready.then(() => {
        log.levelSlides.push({
          nav: document.documentElement.dataset.menuSheetNav,
          animations: document.getAnimations().map((animation) => {
            const effect = animation.effect as KeyframeEffect;
            const name = (animation as CSSAnimation).animationName;
            return `${effect.pseudoElement} ${name}`;
          }),
        });
      });
      return transition;
    }) as typeof document.startViewTransition;
  }
  log.stop = () => {
    document.removeEventListener("animationstart", onAnimation);
    document.removeEventListener("transitionrun", onTransition);
    if (original) {
      document.startViewTransition = original;
    }
  };
  return log;
}

// Emulates `prefers-reduced-motion: reduce`, or turns it back off.
export async function emulateReducedMotion(enabled = true) {
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [
      {
        name: "prefers-reduced-motion",
        value: enabled ? "reduce" : "no-preference",
      },
    ],
  });
}
