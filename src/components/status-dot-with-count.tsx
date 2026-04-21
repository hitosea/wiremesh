import { StatusDot } from "./status-dot";

export function StatusDotWithCount({
  status,
  label,
  count,
  className,
}: {
  status: string;
  label: string;
  count?: number | null;
  className?: string;
}) {
  const showCount = status === "online" && typeof count === "number" && count >= 2;
  return (
    <StatusDot
      status={status}
      label={showCount ? `${label} x ${count}` : label}
      className={className}
    />
  );
}
