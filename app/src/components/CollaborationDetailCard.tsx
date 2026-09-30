export function CollaborationDetailCard({
  label,
  value,
  meta,
}: {
  label: string;
  value: string;
  meta?: string;
}) {
  return (
    <div className="share-dialog__card">
      <span className="share-dialog__label">{label}</span>
      <strong>{value}</strong>
      {meta ? <span className="share-dialog__meta">{meta}</span> : null}
    </div>
  );
}
