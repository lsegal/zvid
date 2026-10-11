import type * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import {
  type ComponentPropsWithoutRef,
  createContext,
  type MouseEvent,
  type RefObject,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useSheetPresence } from "../../hooks/useSheetPresence.ts";
import {
  MenuSheetFrame,
  navigateMenuSheet,
} from "../mobile/MenuSheetFrame.tsx";

// The dropdown menu parts as the phone shell shows them (#1198): the menu
// opens as the same bottom sheet as the timeline's long-press menu, its
// rows at full width, and a submenu replaces the sheet's rows behind a Back
// row instead of opening beside its parent. Each part takes the props of
// its Radix counterpart, so menus need no phone-specific code.

type PhoneMenu = {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: RefObject<HTMLElement | null>;
};

// Set by a dropdown menu's root in the phone shell; null on the desktop.
export const PhoneMenuContext = createContext<PhoneMenu | null>(null);

export function usePhoneMenu() {
  return useContext(PhoneMenuContext);
}

type SheetLevel = { id: string; label: string };

type SheetNav = {
  trail: SheetLevel[];
  // Where submenu levels render, after the top level's rows.
  host: HTMLElement | null;
  push: (level: SheetLevel) => void;
  close: () => void;
};

const SheetNavContext = createContext<SheetNav | null>(null);

// The submenu a part sits in: its id and how deep it is, 0 at the top.
type SubLevel = { id: string; depth: number };

const SubLevelContext = createContext<SubLevel>({ id: "", depth: 0 });

const CheckedContext = createContext(false);

function useSheetNav() {
  const nav = useContext(SheetNavContext);
  if (!nav) {
    throw new Error("Phone menu parts belong inside DropdownMenuContent");
  }
  return nav;
}

type RootProps = ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Root>;

// Keeps the open state, controlled or not, where the sheet can read it.
export function usePhoneMenuState({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
}: RootProps): PhoneMenu {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const triggerRef = useRef<HTMLElement | null>(null);
  const open = controlledOpen ?? uncontrolledOpen;
  return {
    open,
    triggerRef,
    setOpen(next) {
      if (controlledOpen === undefined) {
        setUncontrolledOpen(next);
      }
      onOpenChange?.(next);
    },
  };
}

// Radix's select event: an item's onSelect can call preventDefault() to
// keep the menu open, as checkbox rows that toggle in place do.
function selectEvent() {
  return new Event("menu.itemSelect", { bubbles: true, cancelable: true });
}

type ContentProps = ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.Content
>;

export function PhoneMenuContent(props: ContentProps) {
  const menu = usePhoneMenu();
  const presence = useSheetPresence(menu?.open ?? false);
  if (!menu || !presence.present) {
    return null;
  }
  return (
    <OpenPhoneMenuContent
      {...props}
      closing={presence.closing}
      key={presence.key}
      menu={menu}
    />
  );
}

function OpenPhoneMenuContent({
  menu,
  closing,
  children,
  onCloseAutoFocus,
  "aria-label": ariaLabel,
}: ContentProps & { menu: PhoneMenu; closing: boolean }) {
  const [trail, setTrail] = useState<SheetLevel[]>([]);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const onCloseAutoFocusRef = useRef(onCloseAutoFocus);
  onCloseAutoFocusRef.current = onCloseAutoFocus;
  const trigger = menu.triggerRef.current;
  const label =
    ariaLabel ??
    trigger?.getAttribute("aria-label") ??
    trigger?.textContent?.trim() ??
    "Menu";

  // Focus goes back to the menu's button once it closes, unless the menu's
  // owner moves it elsewhere, as Radix's popover does. That happens as the
  // sheet starts sliding away, not once it's gone.
  useEffect(() => {
    if (closing) {
      return;
    }
    const triggerRef = menu.triggerRef;
    return () => {
      window.setTimeout(() => {
        const event = new Event("focusScope.autoFocusOnUnmount", {
          cancelable: true,
        });
        onCloseAutoFocusRef.current?.(event);
        if (!event.defaultPrevented) {
          triggerRef.current?.focus({ preventScroll: true });
        }
      }, 0);
    };
  }, [closing, menu.triggerRef]);

  const nav: SheetNav = {
    trail,
    host,
    push: (level) =>
      navigateMenuSheet("forward", () =>
        setTrail((current) => [...current, level]),
      ),
    close: () => menu.setOpen(false),
  };
  return (
    <SheetNavContext.Provider value={nav}>
      <MenuSheetFrame
        closing={closing}
        label={label}
        levelKey={trail.map((level) => level.id).join("/")}
        onBack={() => setTrail((current) => current.slice(0, -1))}
        onClose={nav.close}
        parentLabel={trail.at(-1)?.label}
      >
        <div className="mobile-menu-sheet__level" hidden={trail.length > 0}>
          {children}
        </div>
        <div className="mobile-menu-sheet__levels" ref={setHost} />
      </MenuSheetFrame>
    </SheetNavContext.Provider>
  );
}

function rowClass(className: string | undefined) {
  return ["mobile-menu-sheet__item", className].filter(Boolean).join(" ");
}

type ItemProps = ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>;

export function PhoneMenuItem({
  asChild: _asChild,
  textValue: _textValue,
  className,
  disabled,
  onSelect,
  onClick,
  ...props
}: ItemProps) {
  const nav = useSheetNav();
  return (
    <button
      {...(props as ComponentPropsWithoutRef<"button">)}
      className={rowClass(className)}
      disabled={disabled}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        onClick?.(event as unknown as MouseEvent<HTMLDivElement>);
        const select = selectEvent();
        onSelect?.(select);
        if (!select.defaultPrevented) {
          nav.close();
        }
      }}
      role="menuitem"
      type="button"
    />
  );
}

type CheckboxItemProps = ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.CheckboxItem
>;

export function PhoneMenuCheckboxItem({
  asChild: _asChild,
  textValue: _textValue,
  checked = false,
  className,
  disabled,
  onCheckedChange,
  onSelect,
  onClick,
  ...props
}: CheckboxItemProps) {
  const nav = useSheetNav();
  const isChecked = checked === true;
  return (
    <CheckedContext.Provider value={isChecked}>
      <button
        {...(props as ComponentPropsWithoutRef<"button">)}
        aria-checked={checked === "indeterminate" ? "mixed" : isChecked}
        className={rowClass(className)}
        disabled={disabled}
        onClick={(event: MouseEvent<HTMLButtonElement>) => {
          onClick?.(event as unknown as MouseEvent<HTMLDivElement>);
          const select = selectEvent();
          onSelect?.(select);
          onCheckedChange?.(!isChecked);
          if (!select.defaultPrevented) {
            nav.close();
          }
        }}
        role="menuitemcheckbox"
        type="button"
      />
    </CheckedContext.Provider>
  );
}

type ItemIndicatorProps = ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.ItemIndicator
>;

export function PhoneMenuItemIndicator({
  asChild: _asChild,
  forceMount,
  ...props
}: ItemIndicatorProps) {
  const checked = useContext(CheckedContext);
  return checked || forceMount ? <span {...props} /> : null;
}

type SubProps = ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Sub>;

export function PhoneMenuSub({ children }: SubProps) {
  const parent = useContext(SubLevelContext);
  const id = useId();
  return (
    <SubLevelContext.Provider value={{ id, depth: parent.depth + 1 }}>
      {children}
    </SubLevelContext.Provider>
  );
}

type SubTriggerProps = ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.SubTrigger
>;

export function PhoneMenuSubTrigger({
  asChild: _asChild,
  textValue,
  className,
  disabled,
  onClick,
  ...props
}: SubTriggerProps) {
  const nav = useSheetNav();
  const sub = useContext(SubLevelContext);
  return (
    <button
      {...(props as ComponentPropsWithoutRef<"button">)}
      aria-haspopup="menu"
      className={rowClass(className)}
      disabled={disabled}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        onClick?.(event as unknown as MouseEvent<HTMLDivElement>);
        nav.push({
          id: sub.id,
          label: textValue ?? event.currentTarget.textContent?.trim() ?? "",
        });
      }}
      role="menuitem"
      type="button"
    />
  );
}

type SubContentProps = ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.SubContent
>;

// A submenu's rows render into the sheet while it, or one of its own
// submenus, is open, shown only while it is the deepest level.
export function PhoneMenuSubContent({ children }: SubContentProps) {
  const nav = useSheetNav();
  const sub = useContext(SubLevelContext);
  if (!nav.host || nav.trail[sub.depth - 1]?.id !== sub.id) {
    return null;
  }
  return createPortal(
    <div
      className="mobile-menu-sheet__level"
      hidden={nav.trail.length !== sub.depth}
    >
      {children}
    </div>,
    nav.host,
  );
}

type LabelProps = ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>;

export function PhoneMenuLabel({
  asChild: _asChild,
  className,
  ...props
}: LabelProps) {
  return (
    <div
      {...props}
      className={["mobile-menu-sheet__heading", className]
        .filter(Boolean)
        .join(" ")}
    />
  );
}

type GroupProps = ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Group>;

export function PhoneMenuGroup({ asChild: _asChild, ...props }: GroupProps) {
  // biome-ignore lint/a11y/useSemanticElements: a menu's group, as Radix renders it
  return <div role="group" {...props} />;
}

export function PhoneMenuSeparator() {
  return <hr className="mobile-menu-sheet__separator" />;
}
