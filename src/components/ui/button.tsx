import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-[background-color,color,box-shadow,transform] duration-150 disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.98]",
  {
    variants: {
      variant: {
        primary: "bg-accent-deep text-white shadow-[0_2px_4px_rgb(0_113_227/0.15)] hover:bg-[#0077ed] hover:shadow-[0_4px_12px_rgb(0_113_227/0.2)]",
        accent: "bg-accent text-accent-ink hover:bg-[#d4e7ff]",
        outline:
          "bg-surface text-ink shadow-[0_1px_2px_rgb(20_20_18/0.05)] ring-1 ring-line-strong ring-inset hover:bg-canvas",
        ghost: "text-ink-soft hover:bg-ink/5 hover:text-ink",
      },
      size: {
        sm: "h-8 px-3.5",
        md: "h-10 px-5",
        lg: "h-12 px-7 text-[15px]",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
