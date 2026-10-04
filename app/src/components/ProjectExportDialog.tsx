import { useId, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import "./project-export-dialog.css";

export type ProjectExportOptions = {
  // Whether the media linked to the project goes into the .zvd archive.
  includeMedia: boolean;
};

type ProjectExportDialogProps = {
  open: boolean;
  // The checkbox's value each time the dialog opens.
  initialIncludeMedia: boolean;
  onExport: (options: ProjectExportOptions) => void;
  // Called for Cancel, Escape, clicking outside and the close button.
  onCancel: () => void;
};

/**
 * File ▸ Export Project: asks whether to include the project's media files
 * in the exported archive.
 */
export function ProjectExportDialog({
  open,
  initialIncludeMedia,
  onExport,
  onCancel,
}: ProjectExportDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="project-export-dialog">
        {open ? (
          <ProjectExportForm
            initialIncludeMedia={initialIncludeMedia}
            onExport={onExport}
            onCancel={onCancel}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// Mounted only while the dialog is open, so the checkbox starts from
// initialIncludeMedia every time it opens.
function ProjectExportForm({
  initialIncludeMedia,
  onExport,
  onCancel,
}: Omit<ProjectExportDialogProps, "open">) {
  const [includeMedia, setIncludeMedia] = useState(initialIncludeMedia);
  const hintId = useId();

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onExport({ includeMedia });
      }}
    >
      <DialogHeader>
        <DialogTitle>Export Project</DialogTitle>
        <DialogDescription>
          Saves the project as a .zvd archive.
        </DialogDescription>
      </DialogHeader>
      <label className="project-export__option">
        <input
          aria-describedby={hintId}
          checked={includeMedia}
          onChange={(event) => setIncludeMedia(event.target.checked)}
          type="checkbox"
        />
        <span>Include media files</span>
      </label>
      <p className="project-export__hint" id={hintId}>
        Copies the media linked to the project into the archive.
      </p>
      <DialogFooter>
        <button className="ghost-button" onClick={onCancel} type="button">
          Cancel
        </button>
        <button className="ghost-button ghost-button--accent" type="submit">
          Export
        </button>
      </DialogFooter>
    </form>
  );
}
