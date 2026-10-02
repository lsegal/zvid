// The down chevron beside a top bar menu's name.
export function MenuChevron() {
  return (
    <span className="menubar-item__chevron" aria-hidden="true">
      <svg viewBox="0 0 16 16" role="presentation">
        <path
          d="M4.47 6.22a.75.75 0 0 1 1.06.03L8 8.84l2.47-2.59a.75.75 0 1 1 1.08 1.04l-3.01 3.16a.75.75 0 0 1-1.08 0L4.44 7.29a.75.75 0 0 1 .03-1.07Z"
          fill="currentColor"
        />
      </svg>
    </span>
  );
}
