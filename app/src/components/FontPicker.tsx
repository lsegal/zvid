import { CheckIcon } from "@heroicons/react/24/solid";
import { Command } from "cmdk";
import { useState } from "react";
import {
  BUNDLED_FONTS,
  canQueryLocalFonts,
  findBundledFont,
  formatFontChoice,
  GOOGLE_FONTS,
  googleFontsCssUrl,
  loadGoogleStylesheet,
  parseFontChoice,
  queryLocalFontFamilies,
} from "../text-fonts";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

type FontRow = { value: string; family: string; cssFamily: string };

export const LOCAL_FONT_NOTE =
  "Local: may look different for collaborators and other machines";

function rowFor(value: string): FontRow {
  const choice = parseFontChoice(value);
  return {
    value: formatFontChoice(choice),
    family: choice.family,
    cssFamily:
      (choice.source === "bundled" &&
        findBundledFont(choice.family)?.cssFamily) ||
      choice.family,
  };
}

// The rows of a group, with the current font added when the group is its
// source but doesn't list it, such as a Google font typed into the search.
function withCurrent(rows: FontRow[], current: FontRow, source: string) {
  return parseFontChoice(current.value).source === source &&
    !rows.some((row) => row.value === current.value)
    ? [current, ...rows]
    : rows;
}

/**
 * A searchable font list in a popover: fonts bundled with the app, Google
 * Fonts loaded on demand, and fonts installed on this machine. Each row
 * previews the font in its own face.
 */
export function FontPicker({
  value,
  label,
  onChange,
}: {
  value: string;
  label: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [localFamilies, setLocalFamilies] = useState<string[] | null>(null);
  const [localError, setLocalError] = useState("");
  const current = rowFor(value);
  const bundled = BUNDLED_FONTS.map((font) => rowFor(font.family));
  const google = GOOGLE_FONTS.map((family) =>
    rowFor(formatFontChoice({ source: "google", family })),
  );
  const local = (localFamilies ?? []).map((family) =>
    rowFor(formatFontChoice({ source: "local", family })),
  );
  const query = search.trim();
  const typedGoogle =
    query &&
    !google.some((row) => row.family.toLowerCase() === query.toLowerCase())
      ? rowFor(formatFontChoice({ source: "google", family: query }))
      : undefined;

  function choose(next: string) {
    setOpen(false);
    setSearch("");
    if (next !== current.value) {
      onChange(next);
    }
  }

  async function showLocalFonts() {
    try {
      setLocalFamilies(await queryLocalFontFamilies());
      setLocalError("");
    } catch {
      setLocalError("Local fonts weren't allowed.");
    }
  }

  function renderRow(row: FontRow, note?: string) {
    return (
      <Command.Item
        className="font-picker__item"
        key={row.value}
        keywords={[row.family]}
        onSelect={() => choose(row.value)}
        title={note}
        value={row.value}
      >
        <span
          className="font-picker__preview"
          style={{ fontFamily: `"${row.cssFamily}", sans-serif` }}
        >
          {row.family}
        </span>
        {row.value === current.value ? (
          <CheckIcon aria-hidden="true" className="font-picker__check" />
        ) : null}
      </Command.Item>
    );
  }

  return (
    <div className="fx-font">
      <span className="fx-font__label">{label}</span>
      <Popover
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            // Previews every listed Google font; the browser only downloads
            // the faces as their rows draw.
            void loadGoogleStylesheet(googleFontsCssUrl(GOOGLE_FONTS));
          } else {
            setSearch("");
          }
        }}
        open={open}
      >
        <PopoverTrigger asChild>
          <button
            aria-label={`${label}: ${current.family}`}
            className="fx-font__trigger"
            data-fx-no-drag
            style={{ fontFamily: `"${current.cssFamily}", sans-serif` }}
            title={
              parseFontChoice(current.value).source === "local"
                ? LOCAL_FONT_NOTE
                : current.family
            }
            type="button"
          >
            {current.family}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="font-picker">
          <Command label="Fonts" loop>
            <Command.Input
              autoFocus
              className="font-picker__search"
              onValueChange={setSearch}
              placeholder="Search fonts"
              value={search}
            />
            <Command.List className="font-picker__list">
              <Command.Empty className="font-picker__empty">
                No fonts found
              </Command.Empty>
              <Command.Group heading="Bundled">
                {withCurrent(bundled, current, "bundled").map((row) =>
                  renderRow(row),
                )}
              </Command.Group>
              <Command.Group heading="Google Fonts">
                {withCurrent(google, current, "google").map((row) =>
                  renderRow(row),
                )}
                {typedGoogle ? (
                  <Command.Item
                    className="font-picker__item"
                    keywords={[query]}
                    onSelect={() => choose(typedGoogle.value)}
                    value={`${typedGoogle.value} (typed)`}
                  >
                    Use Google Font “{query}”
                  </Command.Item>
                ) : null}
              </Command.Group>
              <Command.Group heading="Local">
                {withCurrent(local, current, "local").map((row) =>
                  renderRow(row, LOCAL_FONT_NOTE),
                )}
                {localFamilies === null && canQueryLocalFonts() ? (
                  <Command.Item
                    className="font-picker__item"
                    forceMount
                    onSelect={() => void showLocalFonts()}
                    value="show local fonts"
                  >
                    Show fonts on this computer…
                  </Command.Item>
                ) : null}
                {localError ? (
                  <p className="font-picker__note">{localError}</p>
                ) : null}
                <p className="font-picker__note">{LOCAL_FONT_NOTE}</p>
              </Command.Group>
            </Command.List>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
