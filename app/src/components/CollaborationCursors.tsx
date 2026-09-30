import type { CollaborationRemoteCursor } from "../app/types.ts";

type CollaborationCursorsProps = {
  cursors: CollaborationRemoteCursor[];
};

// Collaborators' pointers over the app, each labelled with their name.
export function CollaborationCursors({ cursors }: CollaborationCursorsProps) {
  return cursors.length ? (
    <div className="collaboration-cursor-layer" aria-hidden="true">
      {cursors.map((cursor) => (
        <div
          key={cursor.clientId}
          className="collaboration-cursor"
          style={{
            left: `${cursor.x * 100}%`,
            top: `${cursor.y * 100}%`,
            color: cursor.color,
          }}
        >
          <svg viewBox="0 0 20 20" role="presentation">
            <path
              d="M3 2.5v12.7c0 .6.72.9 1.14.48l3.2-3.12l2.32 4.34a.9.9 0 0 0 1.22.37l1.56-.8a.9.9 0 0 0 .37-1.22L10.5 11l4.45-.56c.6-.08.84-.81.39-1.22L3.97 1.88A.67.67 0 0 0 3 2.5Z"
              fill="currentColor"
            />
          </svg>
          <span
            className="collaboration-cursor__label"
            style={{ backgroundColor: cursor.color }}
          >
            {cursor.name}
          </span>
        </div>
      ))}
    </div>
  ) : null;
}
