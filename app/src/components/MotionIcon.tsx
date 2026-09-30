// Heroicons has no motion glyph, so this draws one in its 24/solid style: a
// ball with three speed lines trailing it.
export function MotionIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path
        d="M15.75 6a6 6 0 1 1 0 12 6 6 0 0 1 0-12ZM5.25 6.75H9a.75.75 0 0 1 0 1.5H5.25a.75.75 0 0 1 0-1.5ZM3 11.25h4.5a.75.75 0 0 1 0 1.5H3a.75.75 0 0 1 0-1.5ZM5.25 15.75H9a.75.75 0 0 1 0 1.5H5.25a.75.75 0 0 1 0-1.5Z"
        fill="currentColor"
      />
    </svg>
  );
}
