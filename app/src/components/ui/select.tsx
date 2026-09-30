import { CheckIcon, ChevronDownIcon } from "@heroicons/react/24/solid";
import * as SelectPrimitive from "@radix-ui/react-select";
import "./select.css";

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export type SelectOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
  /** Why a disabled option can't be picked, shown as its tooltip. */
  reason?: string;
};

type SelectProps<T extends string> = {
  value: T;
  options: readonly SelectOption<T>[];
  onValueChange: (value: T) => void;
  className?: string;
  contentClassName?: string;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  [data: `data-${string}`]: string | boolean | undefined;
};

// A themed dropdown in place of a native <select>, whose option list some
// platforms (Chromium on Windows) paint light gray. The list opens in a
// portal in the app's dark menu surface, with Radix's keyboard navigation,
// typeahead and ARIA.
export function Select<T extends string>({
  value,
  options,
  onValueChange,
  className,
  contentClassName,
  disabled,
  ...triggerProps
}: SelectProps<T>) {
  return (
    <SelectPrimitive.Root
      disabled={disabled}
      onValueChange={(next) => onValueChange(next as T)}
      value={value}
    >
      <SelectPrimitive.Trigger
        className={cn("select-trigger", className)}
        {...triggerProps}
      >
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon className="select-trigger__icon">
          <ChevronDownIcon aria-hidden="true" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          className={cn("select-content", contentClassName)}
          position="popper"
          sideOffset={6}
        >
          <SelectPrimitive.Viewport className="select-content__viewport">
            {options.map((option) => (
              <SelectPrimitive.Item
                className="select-item"
                disabled={option.disabled}
                key={option.value}
                title={option.reason}
                value={option.value}
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="select-item__check">
                  <CheckIcon aria-hidden="true" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
