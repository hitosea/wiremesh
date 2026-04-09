import { cn } from "@/lib/utils";

const DOT_COLORS: Record<string, string> = {
  online: "bg-emerald-500",
  offline: "bg-muted-foreground/50",
  installing: "bg-blue-500",
  error: "bg-destructive",
  active: "bg-emerald-500",
  inactive: "bg-muted-foreground/50",
  configuring: "bg-blue-500",
  degraded: "bg-yellow-500",
};

const TEXT_COLORS: Record<string, string> = {
  online: "text-emerald-600 dark:text-emerald-400",
  offline: "text-muted-foreground",
  installing: "text-blue-600 dark:text-blue-400",
  error: "text-destructive",
  active: "text-emerald-600 dark:text-emerald-400",
  inactive: "text-muted-foreground",
  configuring: "text-blue-600 dark:text-blue-400",
  degraded: "text-yellow-600 dark:text-yellow-400",
};

export function StatusDot({
  status,
  label,
  className,
}: {
  status: string;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium",
        TEXT_COLORS[status] ?? "text-muted-foreground",
        className,
      )}
    >
      <span
        className={cn(
          "size-2 rounded-full shrink-0",
          DOT_COLORS[status] ?? "bg-muted-foreground/50",
        )}
      />
      {label}
    </span>
  );
}
