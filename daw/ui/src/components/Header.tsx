import { formatTimer, statusLabel } from "../format.ts";
import type { Camera, Phase } from "../ipc/types.ts";
import { CameraSelect } from "./CameraSelect.tsx";

type Props = {
  phase: Phase;
  elapsedMs: number;
  cameras: Camera[];
  cameraId: string | null;
  selectDisabled: boolean;
  onSelect: (id: string) => void;
};

export function Header({
  phase,
  elapsedMs,
  cameras,
  cameraId,
  selectDisabled,
  onSelect,
}: Props) {
  return (
    <header className="header">
      {phase === "capturing" ? (
        <output className="timer-pill" aria-label="Capture time">
          {formatTimer(elapsedMs)}
        </output>
      ) : (
        <h1 className="status-label">{statusLabel(phase)}</h1>
      )}
      <div className="header-controls">
        <span
          className={`status-dot is-${phase}`}
          role="img"
          aria-label={statusLabel(phase)}
        />
        <CameraSelect
          cameras={cameras}
          selectedId={cameraId}
          disabled={selectDisabled}
          onSelect={onSelect}
        />
      </div>
    </header>
  );
}
