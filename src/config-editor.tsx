import * as THREE from "three";
import { ChevronRight, RotateCcw, Search } from "lucide-react";
import { memo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { QuickSettings } from "./quick-settings";
import { SettingsColorInput, SettingsSlider } from "./settings-controls";
import { useSetting } from "./settings/react";
import { settings } from "./settings/store";
import { definition, SETTINGS_GROUPS, SECTION_TITLES, SECTION_DESCRIPTIONS, type SectionId } from "./settings/definition";
import type { AnyNode, SettingPath } from "./settings/schema";
import type { WeatherPresetId } from "./weather";

interface ConfigEditorProps {
  query: string;
  onQueryChange: (query: string) => void;
  weather: WeatherPresetId;
  rainEnabled: boolean;
  soundEnabled: boolean;
  onWeatherChange: (id: WeatherPresetId) => void;
  onRainChange: (enabled: boolean) => void;
  onSoundChange: (enabled: boolean) => void;
  onResetSection: (sectionIds: readonly SectionId[]) => void;
  onResetAtmosphere: () => void;
  selectedFamily: number;
  previewFamily: number | null;
  onFamilyChange: (index: number) => void;
  onPreviewFamilyChange: (index: number | null) => void;
}

const prettify = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .replace(/^./, (character) => character.toUpperCase());

const pathText = (path: SettingPath): string => path.map((part) => String(part)).join(" ");

const formatNumber = (value: number): string =>
  Number.isInteger(value)
    ? String(value)
    : value.toLocaleString("en-US", { maximumFractionDigits: 3, useGrouping: false });

function hexFromInt(value: number): string {
  return `#${Math.max(0, Math.min(0xffffff, Math.round(value))).toString(16).padStart(6, "0")}`;
}

function hexFromRgb(value: readonly number[]): string {
  return `#${new THREE.Color().setRGB(value[0], value[1], value[2]).getHexString(THREE.SRGBColorSpace)}`;
}

function rgbFromHex(hex: string): [number, number, number] {
  const channels = new THREE.Color(hex).toArray();
  return [Number(channels[0].toFixed(4)), Number(channels[1].toFixed(4)), Number(channels[2].toFixed(4))];
}

/** Static text a node contributes to search: its own label/description/path,
 * plus (for lists) each item's fixed default label — e.g. koi palette names. */
function searchText(node: AnyNode, path: SettingPath, label: string): string {
  let text = `${prettify(label)} ${node.description ?? ""} ${pathText(path)}`;
  if (node.kind === "group") {
    for (const key of Object.keys(node.children)) {
      text += ` ${searchText(node.children[key], [...path, key], key)}`;
    }
  } else if (node.kind === "list" || node.kind === "collection") {
    for (const item of node.defaults) {
      const name = (item as { name?: unknown }).name;
      if (typeof name === "string") text += ` ${name}`;
    }
  }
  return text.toLowerCase();
}

function matchesQuery(node: AnyNode, path: SettingPath, label: string, query: string): boolean {
  return !query || searchText(node, path, label).includes(query);
}

function itemLabel(node: AnyNode, path: SettingPath, index: number): string {
  if (node.kind === "group" && "name" in node.children) {
    const value = settings.get([...path, "name"]);
    if (typeof value === "string" && value) return value;
  }
  return `Item ${index + 1}`;
}

function LeafControl({ node, path, label }: { node: AnyNode; path: SettingPath; label: string }) {
  const id = path.join("-");

  // biome-ignore lint/correctness/useHookAtTopLevel: node.kind is stable per mounted component instance
  switch (node.kind) {
    case "bool": {
      const [value, setValue] = useSetting<boolean>(path);
      return (
        <div className="config-property-row config-property-row--switch" data-base-ui-swipe-ignore>
          <Label htmlFor={id}>{prettify(label)}</Label>
          <Switch id={id} checked={value} onCheckedChange={(checked) => setValue(checked)} />
        </div>
      );
    }
    case "color": {
      const [value, setValue] = useSetting<number>(path);
      const hex = hexFromInt(value);
      return (
        <div className="config-property-row config-property-row--color" data-base-ui-swipe-ignore>
          <Label htmlFor={id}>{prettify(label)}</Label>
          <div className="color-control">
            <SettingsColorInput id={id} value={hex} onChange={(next) => setValue(Number.parseInt(next.slice(1), 16))} />
            <code>{hex.toUpperCase()}</code>
          </div>
        </div>
      );
    }
    case "rgb": {
      const [value, setValue] = useSetting<readonly [number, number, number]>(path);
      const hex = hexFromRgb(value);
      return (
        <div className="config-property-row config-property-row--color" data-base-ui-swipe-ignore>
          <Label htmlFor={id}>{prettify(label)}</Label>
          <div className="color-control">
            <SettingsColorInput id={id} value={hex} onChange={(next) => setValue(rgbFromHex(next))} />
            <code>{hex.toUpperCase()}</code>
          </div>
        </div>
      );
    }
    case "num": {
      const [value, setValue] = useSetting<number>(path);
      return (
        <div className="config-property-row" data-base-ui-swipe-ignore>
          <Label>{prettify(label)}</Label>
          <SettingsSlider
            label={prettify(label)}
            aria-label={`${prettify(label)} value`}
            showLabel={false}
            min={node.min}
            max={node.max}
            step={node.step}
            value={value}
            onValueChange={(next) => setValue(node.int ? Math.round(next) : next, path.join("."))}
            formatValue={formatNumber}
            className="drawer-elastic-slider"
          />
        </div>
      );
    }
    case "index": {
      const [value, setValue] = useSetting<number>(path);
      const target = settings.get(node.of);
      const max = Array.isArray(target) ? Math.max(0, target.length - 1) : 0;
      return (
        <div className="config-property-row" data-base-ui-swipe-ignore>
          <Label>{prettify(label)}</Label>
          <SettingsSlider
            label={prettify(label)}
            aria-label={`${prettify(label)} value`}
            showLabel={false}
            min={0}
            max={max}
            step={1}
            value={value}
            onValueChange={(next) => setValue(Math.round(next), path.join("."))}
            formatValue={formatNumber}
            className="drawer-elastic-slider"
          />
        </div>
      );
    }
    case "range": {
      const [value, setValue] = useSetting<readonly [number, number]>(path);
      const key = path.join(".");
      return (
        <div className="config-cluster" data-base-ui-swipe-ignore>
          <div className="config-cluster__label">{prettify(label)}</div>
          <div className="config-property-row" data-base-ui-swipe-ignore>
            <Label>Minimum</Label>
            <SettingsSlider
              label="Minimum" aria-label="Minimum value" showLabel={false}
              min={node.min} max={value[1]} step={node.step} value={value[0]}
              onValueChange={(next) => setValue([next, value[1]], key)}
              formatValue={formatNumber} className="drawer-elastic-slider"
            />
          </div>
          <div className="config-property-row" data-base-ui-swipe-ignore>
            <Label>Maximum</Label>
            <SettingsSlider
              label="Maximum" aria-label="Maximum value" showLabel={false}
              min={value[0]} max={node.max} step={node.step} value={value[1]}
              onValueChange={(next) => setValue([value[0], next], key)}
              formatValue={formatNumber} className="drawer-elastic-slider"
            />
          </div>
        </div>
      );
    }
    case "vec2": {
      const [value, setValue] = useSetting<readonly [number, number]>(path);
      const key = path.join(".");
      return (
        <div className="config-cluster" data-base-ui-swipe-ignore>
          <div className="config-cluster__label">{prettify(label)}</div>
          {(["X", "Y"] as const).map((axisLabel, index) => (
            <div className="config-property-row" key={axisLabel} data-base-ui-swipe-ignore>
              <Label>{axisLabel}</Label>
              <SettingsSlider
                label={axisLabel} aria-label={`${axisLabel} value`} showLabel={false}
                min={node.min} max={node.max} step={node.step} value={value[index]}
                onValueChange={(next) => {
                  const updated: [number, number] = [value[0], value[1]];
                  updated[index] = next;
                  setValue(updated, key);
                }}
                formatValue={formatNumber} className="drawer-elastic-slider"
              />
            </div>
          ))}
        </div>
      );
    }
    case "choice": {
      const [value, setValue] = useSetting<string | number>(path);
      return (
        <div className="config-property-row" data-base-ui-swipe-ignore>
          <Label htmlFor={id}>{prettify(label)}</Label>
          <select
            id={id}
            className="quick-setting__select"
            value={String(value)}
            onChange={(event) => {
              const option = node.options.find((candidate) => String(candidate.value) === event.target.value);
              if (option) setValue(option.value);
            }}
          >
            {node.options.map((option) => (
              <option key={String(option.value)} value={String(option.value)}>{option.label}</option>
            ))}
          </select>
        </div>
      );
    }
    case "text":
      return null; // Hidden fields (e.g. palette `name`) have no control.
    default:
      return null;
  }
}

function SchemaTree({
  node,
  path,
  label,
  query,
  flat,
}: {
  node: AnyNode;
  path: SettingPath;
  label: string;
  query: string;
  flat?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!matchesQuery(node, path, label, query)) return null;

  if (node.kind !== "group" && node.kind !== "list" && node.kind !== "collection") {
    return <LeafControl node={node} path={path} label={label} />;
  }

  const entries: [string, AnyNode][] =
    node.kind === "group"
      ? (Object.entries(node.children) as [string, AnyNode][]).filter(
          ([, child]) => !(child.kind === "text" && child.hidden),
        )
      : node.defaults.map((_, index) => [String(index), node.item] as [string, AnyNode]);

  const isOpen = flat || expanded || Boolean(query);
  const children = isOpen
    ? entries.map(([key, child]) => {
        const childPath = node.kind === "group" ? [...path, key] : [...path, Number(key)];
        const childLabel =
          node.kind === "group" ? key : itemLabel(child, childPath, Number(key));
        return (
          <SchemaTree key={key} node={child} path={childPath} label={childLabel} query={query} />
        );
      })
    : null;

  if (flat) return <div className="config-root">{children}</div>;

  return (
    <details
      className="config-subgroup"
      open={isOpen}
      onToggle={(event) => {
        if (!query) setExpanded(event.currentTarget.open);
      }}
    >
      <summary>
        <ChevronRight aria-hidden="true" />
        <span>{prettify(label)}</span>
        <span>{entries.length}</span>
      </summary>
      {isOpen && <div className="config-subgroup__body">{children}</div>}
    </details>
  );
}

function AdvancedGroup({
  group,
  query,
  onResetSection,
  onPreviewFamilyChange,
}: {
  group: (typeof SETTINGS_GROUPS)[number];
  query: string;
  onResetSection: ConfigEditorProps["onResetSection"];
  onPreviewFamilyChange: ConfigEditorProps["onPreviewFamilyChange"];
}) {
  const [expanded, setExpanded] = useState(false);
  const isOpen = expanded || Boolean(query);
  return (
    <details
      className="config-advanced-group"
      open={isOpen}
      onToggle={(event) => {
        if (event.currentTarget.open && group.id !== "koi") onPreviewFamilyChange(null);
        if (!query) setExpanded(event.currentTarget.open);
      }}
    >
      <summary className="config-section">
        <span>
          <strong>{group.title}</strong>
          <small>{group.description}</small>
        </span>
        <ChevronRight aria-hidden="true" />
      </summary>
      {isOpen && (
        <div className="config-advanced-group__body">
          <button type="button" className="settings-section-reset" onClick={() => onResetSection(group.sectionIds)}>
            <RotateCcw aria-hidden="true" /> Reset {group.title.toLowerCase()}
          </button>
          {group.sectionIds.map((sectionId) => (
            <section className="config-advanced-section" key={sectionId}>
              <div className="config-advanced-section__heading">
                <h4>{SECTION_TITLES[sectionId]}</h4>
                <p>{SECTION_DESCRIPTIONS[sectionId]}</p>
              </div>
              <SchemaTree
                node={definition.children[sectionId]}
                path={[sectionId]}
                label={SECTION_TITLES[sectionId]}
                query={query}
                flat
              />
            </section>
          ))}
        </div>
      )}
    </details>
  );
}

export const ConfigEditor = memo(function ConfigEditor({
  query,
  onQueryChange,
  weather,
  rainEnabled,
  soundEnabled,
  onWeatherChange,
  onRainChange,
  onSoundChange,
  onResetSection,
  onResetAtmosphere,
  selectedFamily,
  previewFamily,
  onFamilyChange,
  onPreviewFamilyChange,
}: ConfigEditorProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const normalizedQuery = query.trim().toLowerCase();
  const showAdvanced = advancedOpen || Boolean(normalizedQuery);
  const visibleGroups = showAdvanced
    ? SETTINGS_GROUPS.filter((group) =>
        !normalizedQuery ||
        group.sectionIds.some((sectionId) =>
          matchesQuery(definition.children[sectionId], [sectionId], SECTION_TITLES[sectionId], normalizedQuery),
        ),
      )
    : [];

  return (
    <>
      {!normalizedQuery && (
        <QuickSettings
          weather={weather}
          rainEnabled={rainEnabled}
          soundEnabled={soundEnabled}
          onWeatherChange={onWeatherChange}
          onRainChange={onRainChange}
          onSoundChange={onSoundChange}
          onResetSection={onResetSection}
          onResetAtmosphere={onResetAtmosphere}
          selectedFamily={selectedFamily}
          previewFamily={previewFamily}
          onFamilyChange={onFamilyChange}
          onPreviewFamilyChange={onPreviewFamilyChange}
        />
      )}
      <details
        className="config-advanced"
        open={showAdvanced}
        onToggle={(event) => {
          if (!normalizedQuery) setAdvancedOpen(event.currentTarget.open);
        }}
      >
        <summary>
          <ChevronRight aria-hidden="true" />
          <span>
            <strong>Advanced controls</strong>
            <small>Fine-tune motion, shapes, colors, and individual placements.</small>
          </span>
        </summary>
        {showAdvanced && (
          <>
            <div className="settings-search">
              <Search aria-hidden="true" />
              <Input
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="Search detailed controls…"
                aria-label="Search detailed controls"
              />
            </div>
            {visibleGroups.length === 0 ? (
              <p className="config-empty">No advanced settings match "{query}".</p>
            ) : (
              <div className="config-sections" aria-label="Advanced settings categories">
                {visibleGroups.map((group) => (
                  <AdvancedGroup
                    key={group.id}
                    group={group}
                    query={normalizedQuery}
                    onResetSection={onResetSection}
                    onPreviewFamilyChange={onPreviewFamilyChange}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </details>
    </>
  );
});
