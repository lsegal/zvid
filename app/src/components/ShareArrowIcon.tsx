// Heroicons' ShareIcon is a node graph, so this draws the curved share arrow
// in its 24/outline style: an arrow pointing right whose tail curves down.
export function ShareArrowIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24">
      <path
        d="M14.25 4.5 20.25 10.5l-6 6M20.25 10.5h-9a7.5 7.5 0 0 0-7.5 7.5v1.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}
