"use client";
import * as React from "react";
import * as DM from "@radix-ui/react-dropdown-menu";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

export const DropdownMenu = DM.Root;
export const DropdownMenuTrigger = DM.Trigger;
export function DropdownMenuContent({ className, align = "end", ...props }: React.ComponentPropsWithoutRef<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content
        align={align}
        sideOffset={6}
        className={cn("z-50 min-w-[180px] overflow-hidden rounded-xl border bg-popover p-1 text-popover-foreground shadow-card-hover data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95", className)}
        {...props}
      />
    </DM.Portal>
  );
}
export function DropdownMenuItem({ className, destructive, ...props }: React.ComponentPropsWithoutRef<typeof DM.Item> & { destructive?: boolean }) {
  return (
    <DM.Item
      className={cn(
        "flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent [&_svg]:h-4 [&_svg]:w-4 [&_svg]:text-muted-foreground",
        destructive && "text-negative [&_svg]:text-negative",
        className,
      )}
      {...props}
    />
  );
}
export const DropdownMenuSeparator = ({ className }: { className?: string }) => <DM.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} />;
export const DropdownMenuLabel = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof DM.Label>) => (
  <DM.Label className={cn("px-2 py-1.5 text-xs text-muted-foreground", className)} {...props} />
);

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export function PopoverContent({ className, align = "end", ...props }: React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={6}
        className={cn("z-50 rounded-xl border bg-popover p-4 text-popover-foreground shadow-card-hover outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95", className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export const TooltipProvider = TooltipPrimitive.Provider;
export function Tip({ content, children, side = "top" }: { content: React.ReactNode; children: React.ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <TooltipPrimitive.Root delayDuration={250}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content side={side} sideOffset={6} className="z-[70] max-w-xs rounded-lg bg-primary px-2.5 py-1.5 text-xs text-primary-foreground shadow-md data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0">
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
