import type { ComponentProps } from "react";
import { ElasticSlider, type ElasticSliderProps } from "@/components/elastic-slider";

// Settings now commit straight to the store on every pointer movement (no
// debounce), and useSetting re-renders synchronously, so this no longer needs
// the old local-state/interactingRef mirror (which could get stuck ignoring
// external updates, e.g. after Undo or Reset). ElasticSlider already manages
// its own controlled/uncontrolled drag state via useControllableState.
export function SettingsSlider({ value, onValueChange, ...props }: ElasticSliderProps & {
  value: number;
}) {
  return <ElasticSlider {...props} value={value} onValueChange={onValueChange} />;
}

export function SettingsColorInput({
  value,
  onChange,
  ...props
}: Omit<ComponentProps<"input">, "value" | "onChange" | "type"> & {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      {...props}
      type="color"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
