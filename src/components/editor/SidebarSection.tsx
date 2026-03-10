import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, type LucideIcon } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

type SidebarSectionProps = {
  title: string;
  icon: LucideIcon;
  defaultOpen?: boolean;
  badge?: string | number;
  children: ReactNode;
};

export function SidebarSection({ title, icon: Icon, defaultOpen = true, badge, children }: SidebarSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={`border-b border-border flex flex-col ${open ? "flex-1 min-h-0" : "flex-none"}`}>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 p-3 hover:bg-muted/30 transition-colors shrink-0"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
        <Icon className="h-4 w-4 text-primary shrink-0" />
        <span className="font-display text-sm font-bold text-foreground">{title}</span>
        {badge !== undefined && badge !== 0 && (
          <span className="ml-auto rounded-full bg-primary/20 text-primary text-[10px] font-semibold px-1.5 py-0.5 min-w-[18px] text-center">
            {badge}
          </span>
        )}
      </button>
      {open && (
        <ScrollArea className="flex-1 min-h-0">
          {children}
        </ScrollArea>
      )}
    </div>
  );
}
