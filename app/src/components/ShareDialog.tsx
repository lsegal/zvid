import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

type ShareDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isStarting: boolean;
  onStart: () => void;
};

// Confirms starting a public share, describing what sharing does for the
// user rather than how the connection works.
export function ShareDialog({
  open,
  onOpenChange,
  isStarting,
  onStart,
}: ShareDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share this session publicly?</DialogTitle>
          <DialogDescription>
            Anyone with the link can join and edit this session with you in real
            time. We'll copy the link to your clipboard. Click Stop Share to end
            sharing at any time.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <DialogClose asChild>
            <button
              className="ghost-button"
              disabled={isStarting}
              type="button"
            >
              Cancel
            </button>
          </DialogClose>
          <button
            className="ghost-button ghost-button--accent"
            disabled={isStarting}
            onClick={onStart}
            type="button"
          >
            {isStarting ? "Starting..." : "Start Sharing"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
