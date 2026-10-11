import type { ReactNode } from "react";
import "../components/mobile/mobile-shell.css";
import "../components/mobile/mobile-panels.css";
import "../components/mobile/mobile-fx-panels.css";
import "../components/mobile/mobile-sheet-motion.css";
import "../components/mobile/mobile-timeline.css";

// Wrappers for stylesheets that style components through a parent class.
// A test renders its component inside the shell whose CSS it covers, so the
// test imports that CSS and `vitest --changed` selects it when the CSS
// changes. Global CSS belongs in setup.ts instead.
//
// There is no tablet shell: tablets keep the desktop layout, which
// coarse-pointer.css (global) adapts to touch; use useTablet from
// viewport.ts.

type ShellProps = {
  children: ReactNode;
  // Extra app-shell modifiers, such as "app-shell--phone-landscape".
  className?: string;
};

// The phone shell's root, as usePhoneShell classes it: the mobile
// stylesheets that MobileShellChrome loads, scoped by .app-shell--phone.
export function PhoneShell({ children, className }: ShellProps) {
  return (
    <div
      className={["app-shell", "app-shell--phone", className]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}

// The desktop editor's root, for CSS scoped by .app-shell alone.
export function DesktopShell({ children, className }: ShellProps) {
  return (
    <div className={["app-shell", className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}
