import {
  AdjustmentsHorizontalIcon,
  FilmIcon,
  PhotoIcon,
  SpeakerWaveIcon,
} from "@heroicons/react/24/solid";
import type { MobileTab } from "../../hooks/useMobileShell.ts";

const TABS: {
  id: MobileTab;
  label: string;
  Icon: typeof FilmIcon;
}[] = [
  { id: "media", label: "Media", Icon: PhotoIcon },
  { id: "edit", label: "Edit", Icon: FilmIcon },
  { id: "fx", label: "FX", Icon: AdjustmentsHorizontalIcon },
  { id: "audio", label: "Audio", Icon: SpeakerWaveIcon },
];

type MobileTabBarProps = {
  activeTab: MobileTab;
  isAudioShown: boolean;
  onSelect: (tab: MobileTab) => void;
};

// The mobile shell's bottom tabs. Media and FX open their sheets, Edit
// closes them back to the timeline, and Audio shows or hides the Audio row.
export function MobileTabBar({
  activeTab,
  isAudioShown,
  onSelect,
}: MobileTabBarProps) {
  return (
    <nav aria-label="Editor" className="mobile-tab-bar">
      {TABS.map(({ id, label, Icon }) => {
        const active = id === "audio" ? isAudioShown : activeTab === id;
        return (
          <button
            aria-pressed={active}
            className={`mobile-tab-bar__tab${active ? " is-active" : ""}`}
            key={id}
            onClick={() => onSelect(id)}
            type="button"
          >
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
