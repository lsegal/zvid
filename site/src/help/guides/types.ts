import type { Accent } from "../content";

// A guide is one detailed page per feature area, at /help/<id>/. Text fields
// accept the inline markup in html.ts: **bold**, `code`, [label](href) and
// [[Key]].

export type Block =
  | { type: "p"; text: string }
  | { type: "h3"; text: string }
  | { type: "list"; items: string[] }
  | { type: "steps"; items: string[] }
  | { type: "note"; text: string; tone?: "tip" | "note" }
  | {
      type: "table";
      head: string[];
      rows: string[][];
      // Narrow first column, like a parameter or key name.
      compact?: boolean;
    }
  | {
      type: "figure";
      // A file in public/shots, without the extension.
      shot: string;
      alt: string;
      caption?: string;
      // Shown at this CSS width at most; shots are captured at 2x.
      width?: number;
    }
  | { type: "video"; id: string; caption?: string }
  | { type: "keys"; rows: { keys: string[]; action: string }[] };

export type Section = {
  id: string;
  title: string;
  blocks: Block[];
};

export type Guide = {
  id: string;
  title: string;
  accent: Accent;
  summary: string;
  sections: Section[];
};
