import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: ReactNode;
  badge?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, badge, subtitle, actions, className }: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-3",
        className
      )}
    >
      <div className="flex items-baseline gap-3 min-w-0 max-w-full">
        <h1 className="text-2xl font-semibold truncate">{title}</h1>
        {badge && <div className="shrink-0 self-center">{badge}</div>}
        {subtitle && (
          <span className="text-base text-muted-foreground truncate">{subtitle}</span>
        )}
      </div>
      {actions && (
        <div className="flex grow justify-end shrink-0 gap-2">{actions}</div>
      )}
    </div>
  );
}
