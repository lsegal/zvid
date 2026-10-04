// Stroked like the Heroicons outline set so the shaft keeps an even,
// anti-aliased weight at 18-20px: a diagonal shaft ending in a star, plus two
// sparkles of distinct sizes.
export function WandIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path d="M4 20 13 11" />
      <path d="M16 4 17.2 6.8 20 8l-2.8 1.2L16 12l-1.2-2.8L12 8l2.8-1.2L16 4Z" />
      <path d="M6.5 3.5v4M4.5 5.5h4" />
      <path d="M19.5 14.5v3M18 16h3" />
    </svg>
  );
}
