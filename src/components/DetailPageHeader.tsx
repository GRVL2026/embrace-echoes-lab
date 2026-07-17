import { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  title: ReactNode;
  subtitle?: ReactNode;
  backTo?: string;
  onBack?: () => void;
  backLabel?: string;
  actions?: ReactNode;
  className?: string;
};

/**
 * Sticky detail-page header with an always-visible back button.
 * Optimised for mobile (min touch target 44x44, title truncated).
 */
export function DetailPageHeader({
  title,
  subtitle,
  backTo,
  onBack,
  backLabel = "Retour",
  actions,
  className,
}: Props) {
  const navigate = useNavigate();
  const handleBack = () => {
    if (onBack) return onBack();
    if (backTo) return navigate(backTo);
    navigate(-1);
  };

  const backButton = (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleBack}
      aria-label={backLabel}
      className="h-11 w-11 flex-shrink-0 -ml-2"
    >
      <ArrowLeft className="h-5 w-5" />
    </Button>
  );

  return (
    <header
      className={cn(
        "sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-border bg-background/85 backdrop-blur px-2 sm:px-4",
        "print:hidden",
        className,
      )}
    >
      {backTo ? (
        <Link to={backTo} aria-label={backLabel} className="flex-shrink-0">
          {backButton}
        </Link>
      ) : (
        backButton
      )}
      <div className="flex-1 min-w-0">
        <div className="truncate font-display text-sm sm:text-base font-semibold leading-tight">
          {title}
        </div>
        {subtitle && (
          <div className="truncate text-[11px] sm:text-xs text-muted-foreground leading-tight">
            {subtitle}
          </div>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-1 flex-shrink-0">{actions}</div>
      )}
    </header>
  );
}
