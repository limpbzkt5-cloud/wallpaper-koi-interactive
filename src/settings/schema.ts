// Typed settings schema: node builders, type inference, and the pure helpers
// (walk/validate/defaults/nodeAt) that the store, persistence, and UI share.
//
// A node describes one setting (or a group of settings). Every node can carry
// a `label`, `description`, `effect` tag, and `keepsFamilyPreview` flag; the
// latter two are inherited from the nearest ancestor that declares them.

export type SettingPath = readonly (string | number)[];

export interface NodeMeta {
  label?: string;
  description?: string;
  // Tag consumed by settings/effects.ts. Inherited: a leaf without its own
  // tag uses the nearest ancestor group's tag.
  effect?: string;
  // When true, editing this leaf must not clear the koi family preview.
  keepsFamilyPreview?: boolean;
}

export interface NumNode extends NodeMeta {
  kind: "num";
  default: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  int?: boolean;
}

export interface RangeNode extends NodeMeta {
  kind: "range";
  default: readonly [number, number];
  min: number;
  max: number;
  step: number;
}

export interface ColorNode extends NodeMeta {
  kind: "color";
  default: number;
}

export interface RgbNode extends NodeMeta {
  kind: "rgb";
  default: readonly [number, number, number];
  min?: number;
  max?: number;
  step?: number;
}

export interface Vec2Node extends NodeMeta {
  kind: "vec2";
  default: readonly [number, number];
  min: number;
  max: number;
  step: number;
}

export interface BoolNode extends NodeMeta {
  kind: "bool";
  default: boolean;
}

export interface ChoiceOption<T> {
  value: T;
  label: string;
}

export interface ChoiceNode<T = string | number> extends NodeMeta {
  kind: "choice";
  default: T;
  options: readonly ChoiceOption<T>[];
}

export interface IndexNode extends NodeMeta {
  kind: "index";
  default: number;
  // Path (from the settings root) to the list/collection this index selects into.
  of: SettingPath;
}

export interface TextNode extends NodeMeta {
  kind: "text";
  default: string;
  hidden?: boolean;
}

// biome-ignore-start lint/suspicious/noExplicitAny: node trees are heterogeneous by nature
export interface GroupNode<Children extends Record<string, AnyNode> = Record<string, AnyNode>>
  extends NodeMeta {
  kind: "group";
  children: Children;
  hidden?: boolean;
}

export interface ListNode<Item extends AnyNode = AnyNode> extends NodeMeta {
  kind: "list";
  item: Item;
  defaults: readonly ValueOf<Item>[];
}

export interface CollectionNode<Item extends AnyNode = AnyNode> extends NodeMeta {
  kind: "collection";
  item: Item;
  defaults: readonly ValueOf<Item>[];
  // Path (from the settings root) to the numeric leaf that drives this
  // collection's length.
  countFrom: SettingPath;
  create: (live: unknown) => ValueOf<Item>;
  max?: number;
}

export type AnyNode =
  | NumNode
  | RangeNode
  | ColorNode
  | RgbNode
  | Vec2Node
  | BoolNode
  | ChoiceNode<any>
  | IndexNode
  | TextNode
  | GroupNode<any>
  | ListNode<any>
  | CollectionNode<any>;
// biome-ignore-end lint/suspicious/noExplicitAny: node trees are heterogeneous by nature

export type ValueOf<N> = N extends { kind: "num" }
  ? number
  : N extends { kind: "range" }
    ? readonly [number, number]
    : N extends { kind: "color" }
      ? number
      : N extends { kind: "rgb" }
        ? readonly [number, number, number]
        : N extends { kind: "vec2" }
          ? readonly [number, number]
          : N extends { kind: "bool" }
            ? boolean
            : N extends { kind: "choice"; default: infer D }
              ? D
              : N extends { kind: "index" }
                ? number
                : N extends { kind: "text" }
                  ? string
                  : N extends { kind: "group"; children: infer C }
                    ? { [K in keyof C]: ValueOf<C[K]> }
                    : N extends { kind: "list"; item: infer I }
                      ? readonly ValueOf<I>[]
                      : N extends { kind: "collection"; item: infer I }
                        ? ValueOf<I>[]
                        : never;

export type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends readonly (infer U)[]
    ? readonly DeepReadonly<U>[]
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

// ---- node builders ---------------------------------------------------

export function num(options: Omit<NumNode, "kind">): NumNode {
  return { kind: "num", ...options };
}

export function range(options: Omit<RangeNode, "kind">): RangeNode {
  return { kind: "range", ...options };
}

export function color(options: Omit<ColorNode, "kind">): ColorNode {
  return { kind: "color", ...options };
}

export function rgb(options: Omit<RgbNode, "kind">): RgbNode {
  return { kind: "rgb", ...options };
}

export function vec2(options: Omit<Vec2Node, "kind">): Vec2Node {
  return { kind: "vec2", ...options };
}

export function bool(options: Omit<BoolNode, "kind">): BoolNode {
  return { kind: "bool", ...options };
}

export function choice<T extends string | number>(
  options: Omit<ChoiceNode<T>, "kind">,
): ChoiceNode<T> {
  return { kind: "choice", ...options };
}

export function index(options: Omit<IndexNode, "kind">): IndexNode {
  return { kind: "index", ...options };
}

export function text(options: Omit<TextNode, "kind">): TextNode {
  return { kind: "text", ...options };
}

export function group<Children extends Record<string, AnyNode>>(
  children: Children,
  options: Omit<GroupNode<Children>, "kind" | "children"> = {},
): GroupNode<Children> {
  return { kind: "group", children, ...options };
}

export function list<Item extends AnyNode>(
  item: Item,
  defaults: readonly ValueOf<Item>[],
  options: Omit<ListNode<Item>, "kind" | "item" | "defaults"> = {},
): ListNode<Item> {
  return { kind: "list", item, defaults, ...options };
}

export function collection<Item extends AnyNode>(
  item: Item,
  defaults: readonly ValueOf<Item>[],
  options: Omit<CollectionNode<Item>, "kind" | "item" | "defaults">,
): CollectionNode<Item> {
  return { kind: "collection", item, defaults, ...options };
}

// ---- pure helpers ------------------------------------------------------

function isContainerNode(
  node: AnyNode,
): node is GroupNode | ListNode | CollectionNode {
  return node.kind === "group" || node.kind === "list" || node.kind === "collection";
}

/** Finds the schema node addressed by `path`, or undefined if it doesn't exist. */
export function nodeAt(root: AnyNode, path: SettingPath): AnyNode | undefined {
  let node: AnyNode | undefined = root;
  for (const segment of path) {
    if (!node) return undefined;
    if (node.kind === "group") {
      node = typeof segment === "string" ? node.children[segment] : undefined;
    } else if (node.kind === "list" || node.kind === "collection") {
      node = typeof segment === "number" ? node.item : undefined;
    } else {
      return undefined;
    }
  }
  return node;
}

/** Builds the full default value tree described by `root`. */
export function defaults(root: AnyNode): unknown {
  if (root.kind === "group") {
    const value: Record<string, unknown> = {};
    for (const key of Object.keys(root.children)) {
      value[key] = defaults(root.children[key]);
    }
    return value;
  }
  if (root.kind === "list" || root.kind === "collection") {
    return structuredClone(root.defaults);
  }
  return structuredClone((root as { default: unknown }).default);
}

export type WalkVisitor = (node: AnyNode, path: SettingPath) => void;

/** Depth-first walk over every node in the tree, including containers. */
export function walk(root: AnyNode, visit: WalkVisitor, path: SettingPath = []): void {
  visit(root, path);
  if (root.kind === "group") {
    for (const key of Object.keys(root.children)) {
      walk(root.children[key], visit, [...path, key]);
    }
  } else if (root.kind === "list" || root.kind === "collection") {
    for (let i = 0; i < root.defaults.length; i += 1) {
      walk(root.item, visit, [...path, i]);
    }
  }
}

/** Depth-first walk over only the leaves (non-container nodes). */
export function walkLeaves(
  root: AnyNode,
  visit: (node: Exclude<AnyNode, GroupNode | ListNode | CollectionNode>, path: SettingPath) => void,
  path: SettingPath = [],
): void {
  walk(root, (node, nodePath) => {
    if (!isContainerNode(node)) {
      visit(node as Exclude<AnyNode, GroupNode | ListNode | CollectionNode>, nodePath);
    }
  }, path);
}

function resolveListLength(node: IndexNode, root: AnyNode, live: unknown): number {
  const target = nodeAt(root, node.of);
  if (target && (target.kind === "list" || target.kind === "collection")) {
    let value: unknown = live;
    for (const segment of node.of) {
      if (value === null || typeof value !== "object") break;
      value = (value as Record<string | number, unknown>)[segment];
    }
    if (Array.isArray(value)) return value.length;
    return target.defaults.length;
  }
  return 1;
}

/**
 * Validates and normalizes `value` against `node`. Returns `undefined` when
 * the value's fundamental type doesn't match the node at all.
 */
export function validate(
  node: AnyNode,
  value: unknown,
  root: AnyNode,
  live?: unknown,
): unknown {
  switch (node.kind) {
    case "num": {
      if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
      let next = Math.min(node.max, Math.max(node.min, value));
      if (node.int) next = Math.round(next);
      return next;
    }
    case "range": {
      if (!Array.isArray(value) || value.length !== 2) return undefined;
      const [rawA, rawB] = value;
      if (typeof rawA !== "number" || typeof rawB !== "number") return undefined;
      const a = Math.min(node.max, Math.max(node.min, rawA));
      const b = Math.min(node.max, Math.max(node.min, rawB));
      return a <= b ? [a, b] : [b, a];
    }
    case "color": {
      if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
      return Math.min(0xffffff, Math.max(0, Math.round(value)));
    }
    case "rgb": {
      if (!Array.isArray(value) || value.length !== 3) return undefined;
      const min = node.min ?? 0;
      const max = node.max ?? 2;
      const channels = value.map((channel) =>
        typeof channel === "number" && Number.isFinite(channel)
          ? Math.min(max, Math.max(min, channel))
          : undefined,
      );
      if (channels.some((channel) => channel === undefined)) return undefined;
      return channels;
    }
    case "vec2": {
      if (!Array.isArray(value) || value.length !== 2) return undefined;
      const channels = value.map((channel) =>
        typeof channel === "number" && Number.isFinite(channel)
          ? Math.min(node.max, Math.max(node.min, channel))
          : undefined,
      );
      if (channels.some((channel) => channel === undefined)) return undefined;
      return channels;
    }
    case "bool":
      return typeof value === "boolean" ? value : undefined;
    case "choice":
      return node.options.some((option) => option.value === value) ? value : undefined;
    case "index": {
      if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
      const length = resolveListLength(node, root, live ?? defaults(root));
      const maximum = Math.max(0, length - 1);
      return Math.min(maximum, Math.max(0, Math.round(value)));
    }
    case "text":
      return typeof value === "string" ? value : undefined;
    default:
      return undefined;
  }
}
