import { statusLabel } from "../format.ts";
import type { Camera, Phase } from "../ipc/types.ts";
import { CameraSelect } from "./CameraSelect.tsx";
import { StatusDot, TimerPill, VisuallyHidden } from "./Status.tsx";

type Props = {
  phase: Phase;
  elapsedMs: number;
  cameras: Camera[];
  cameraId: string | null;
  selectDisabled: boolean;
  selectBusy: boolean;
  onSelect: (id: string) => void;
};

export function Header({
  phase,
  elapsedMs,
  cameras,
  cameraId,
  selectDisabled,
  selectBusy,
  onSelect,
}: Props) {
  const capturing = phase === "capturing";
  return (
    <header className="header">
      <div className="status">
        <StatusDot tone={phase} />
        {/* Announces state changes once; the timer stays out of it. */}
        <h1 className="status-label" role="status">
          {capturing ? (
            <VisuallyHidden>{statusLabel(phase)}</VisuallyHidden>
          ) : (
            statusLabel(phase)
          )}
        </h1>
        {capturing && <TimerPill ms={elapsedMs} />}
      </div>
      <CameraSelect
        cameras={cameras}
        selectedId={cameraId}
        disabled={selectDisabled}
        busy={selectBusy}
        onSelect={onSelect}
      />
    </header>
  );
}
