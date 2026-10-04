import type { useNewSession } from "../hooks/useNewSession.ts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

type NewSessionDialogProps = Pick<
  ReturnType<typeof useNewSession>,
  | "isNewSessionPromptOpen"
  | "setIsNewSessionPromptOpen"
  | "saveAndStartNewSession"
  | "discardAndStartNewSession"
>;

// Asks whether to save unsaved changes before File → New Session replaces
// the session with a blank one.
export function NewSessionDialog({
  isNewSessionPromptOpen,
  setIsNewSessionPromptOpen,
  saveAndStartNewSession,
  discardAndStartNewSession,
}: NewSessionDialogProps) {
  return (
    <Dialog
      open={isNewSessionPromptOpen}
      onOpenChange={setIsNewSessionPromptOpen}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save changes to this session?</DialogTitle>
          <DialogDescription>
            Starting a new session replaces this one. Changes that aren't saved
            will be lost.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button
            className="ghost-button"
            onClick={() => setIsNewSessionPromptOpen(false)}
            type="button"
          >
            Cancel
          </button>
          <button
            className="ghost-button"
            onClick={discardAndStartNewSession}
            type="button"
          >
            Don't Save
          </button>
          <button
            className="ghost-button ghost-button--accent"
            onClick={() => void saveAndStartNewSession()}
            type="button"
          >
            Save
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
