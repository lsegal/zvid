import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import * as React from "react";
import { useShellKind } from "../../hooks/useShellKind.ts";
import { isPhoneShell } from "../../mobile/shell-kind.ts";
import {
  PhoneMenuCheckboxItem,
  PhoneMenuContent,
  PhoneMenuContext,
  PhoneMenuGroup,
  PhoneMenuItem,
  PhoneMenuItemIndicator,
  PhoneMenuLabel,
  PhoneMenuSeparator,
  PhoneMenuSub,
  PhoneMenuSubContent,
  PhoneMenuSubTrigger,
  usePhoneMenu,
  usePhoneMenuState,
} from "./phone-dropdown-menu.tsx";

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

type Props<T extends React.ElementType> = React.ComponentPropsWithoutRef<T>;

// On a phone every dropdown menu opens as a bottom sheet instead
// (phone-dropdown-menu.tsx); each part below picks its phone or Radix form.
function DropdownMenu(props: Props<typeof DropdownMenuPrimitive.Root>) {
  if (!isPhoneShell(useShellKind())) {
    return <DropdownMenuPrimitive.Root {...props} />;
  }
  return <PhoneDropdownMenu {...props} />;
}

function PhoneDropdownMenu(props: Props<typeof DropdownMenuPrimitive.Root>) {
  const menu = usePhoneMenuState(props);
  return (
    <PhoneMenuContext.Provider value={menu}>
      <DropdownMenuPrimitive.Root
        {...props}
        modal={false}
        onOpenChange={menu.setOpen}
        open={menu.open}
      />
    </PhoneMenuContext.Provider>
  );
}

// Each part renders its phone form inside a phone menu, and Radix's
// otherwise.
function phoneOr<P extends object>(
  Phone: React.ComponentType<P>,
  Desktop: React.ComponentType<P>,
) {
  return function DropdownMenuPart(props: P) {
    return usePhoneMenu() ? <Phone {...props} /> : <Desktop {...props} />;
  };
}

const DropdownMenuTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Trigger>,
  Props<typeof DropdownMenuPrimitive.Trigger>
>((props, ref) => {
  const phone = usePhoneMenu();
  return (
    <DropdownMenuPrimitive.Trigger
      {...props}
      ref={(node) => {
        if (phone) {
          phone.triggerRef.current = node;
        }
        if (typeof ref === "function") {
          ref(node);
        } else if (ref) {
          ref.current = node;
        }
      }}
    />
  );
});
DropdownMenuTrigger.displayName = DropdownMenuPrimitive.Trigger.displayName;

const DropdownMenuPortal = DropdownMenuPrimitive.Portal;
const DropdownMenuItem = phoneOr<Props<typeof DropdownMenuPrimitive.Item>>(
  PhoneMenuItem,
  DropdownMenuPrimitive.Item,
);
const DropdownMenuCheckboxItem = phoneOr<
  Props<typeof DropdownMenuPrimitive.CheckboxItem>
>(PhoneMenuCheckboxItem, DropdownMenuPrimitive.CheckboxItem);
const DropdownMenuItemIndicator = phoneOr<
  Props<typeof DropdownMenuPrimitive.ItemIndicator>
>(PhoneMenuItemIndicator, DropdownMenuPrimitive.ItemIndicator);
const DropdownMenuSeparator = phoneOr<
  Props<typeof DropdownMenuPrimitive.Separator>
>(PhoneMenuSeparator, DropdownMenuPrimitive.Separator);
const DropdownMenuGroup = phoneOr<Props<typeof DropdownMenuPrimitive.Group>>(
  PhoneMenuGroup,
  DropdownMenuPrimitive.Group,
);
const DropdownMenuLabel = phoneOr<Props<typeof DropdownMenuPrimitive.Label>>(
  PhoneMenuLabel,
  DropdownMenuPrimitive.Label,
);
const DropdownMenuSub = phoneOr<Props<typeof DropdownMenuPrimitive.Sub>>(
  PhoneMenuSub,
  DropdownMenuPrimitive.Sub,
);
const DropdownMenuSubTrigger = phoneOr<
  Props<typeof DropdownMenuPrimitive.SubTrigger>
>(PhoneMenuSubTrigger, DropdownMenuPrimitive.SubTrigger);

function DropdownMenuShortcut({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn("dropdown-menu-shortcut", className)} {...props} />
  );
}

const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  Props<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 10, ...props }, ref) =>
  usePhoneMenu() ? (
    <PhoneMenuContent {...props} />
  ) : (
    <DropdownMenuPortal>
      <DropdownMenuPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn("dropdown-menu-content", className)}
        {...props}
      />
    </DropdownMenuPortal>
  ),
);
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;

// Submenus share the dropdown's panel styling and open beside their trigger.
const DropdownMenuSubContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  Props<typeof DropdownMenuPrimitive.SubContent>
>(({ className, sideOffset = 6, ...props }, ref) =>
  usePhoneMenu() ? (
    <PhoneMenuSubContent {...props} />
  ) : (
    <DropdownMenuPortal>
      <DropdownMenuPrimitive.SubContent
        ref={ref}
        sideOffset={sideOffset}
        className={cn("dropdown-menu-content", className)}
        {...props}
      />
    </DropdownMenuPortal>
  ),
);
DropdownMenuSubContent.displayName =
  DropdownMenuPrimitive.SubContent.displayName;

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuItemIndicator,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
};
