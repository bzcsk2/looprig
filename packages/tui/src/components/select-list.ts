import { Component, Focusable } from "../tui";
import { truncateToWidth, padding, visibleWidth } from "../utils";
import { matchesKey, parseKey, Key } from "../keys";

export interface SelectListItem {
  label: string;
  description?: string;
}

export interface SelectListTheme {
  selected?: (text: string) => string;
  description?: (text: string) => string;
  filterText?: (text: string) => string;
}

export type SelectListLayout = "list" | "compact" | "full";

const DEFAULT_SELECTED = (t: string) => `\x1b[7m${t}\x1b[0m`;
const DEFAULT_DESC = (t: string) => `\x1b[90m${t}\x1b[0m`;
const DEFAULT_FILTER = (t: string) => `\x1b[36m${t}\x1b[0m`;

export class SelectList implements Component, Focusable {
  #items: SelectListItem[];
  #maxVisible: number;
  #theme: Required<SelectListTheme>;
  #layout: SelectListLayout;
  #selectedIndex = 0;
  #scrollOffset = 0;
  #filter = "";
  #filteredIndices: number[] = [];
  focused = false;

  onSelect?: (item: SelectListItem, index: number) => void;
  onCancel?: () => void;
  onSelectionChange?: (item: SelectListItem, index: number) => void;

  constructor(
    items: SelectListItem[],
    maxVisible: number,
    theme?: SelectListTheme,
    layout: SelectListLayout = "list",
  ) {
    this.#items = items;
    this.#maxVisible = maxVisible;
    this.#theme = {
      selected: theme?.selected ?? DEFAULT_SELECTED,
      description: theme?.description ?? DEFAULT_DESC,
      filterText: theme?.filterText ?? DEFAULT_FILTER,
    };
    this.#layout = layout;
    this.#filteredIndices = items.map((_, i) => i);
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.up) || matchesKey(data, Key.ctrl("p"))) {
      this.#moveSelection(-1);
    } else if (matchesKey(data, Key.down) || matchesKey(data, Key.ctrl("n"))) {
      this.#moveSelection(1);
    } else if (matchesKey(data, Key.pageUp)) {
      this.#moveSelection(-this.#maxVisible);
    } else if (matchesKey(data, Key.pageDown)) {
      this.#moveSelection(this.#maxVisible);
    } else if (matchesKey(data, Key.enter)) {
      const idx = this.#filteredIndices[this.#selectedIndex];
      if (idx !== undefined) this.onSelect?.(this.#items[idx]!, idx);
    } else if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      this.onCancel?.();
    } else {
      const parsed = parseKey(data);
      if (parsed && parsed.length === 1 && parsed >= " ") {
        this.#filter += parsed;
        this.#updateFilter();
      } else if (matchesKey(data, "backspace") || matchesKey(data, Key.ctrl("h"))) {
        this.#filter = this.#filter.slice(0, -1);
        this.#updateFilter();
      }
    }
  }

  #moveSelection(delta: number): void {
    const max = this.#filteredIndices.length;
    if (max === 0) return;
    const prev = this.#selectedIndex;
    this.#selectedIndex = Math.max(0, Math.min(max - 1, this.#selectedIndex + delta));
    if (prev !== this.#selectedIndex) {
      const idx = this.#filteredIndices[this.#selectedIndex];
      if (idx !== undefined) this.onSelectionChange?.(this.#items[idx]!, idx);
      this.#ensureVisible();
    }
  }

  #updateFilter(): void {
    const q = this.#filter.toLowerCase();
    const prevIdx = this.#filteredIndices[this.#selectedIndex];
    const prevItem = prevIdx !== undefined ? this.#items[prevIdx] : undefined;
    this.#filteredIndices = this.#items
      .map((item, i) => ({ item, i }))
      .filter(({ item }) => item.label.toLowerCase().includes(q))
      .map(({ i }) => i);
    this.#selectedIndex = 0;
    this.#scrollOffset = 0;
    const idx = this.#filteredIndices[0];
    const newItem = idx !== undefined ? this.#items[idx] : undefined;
    if (prevItem !== newItem && idx !== undefined) {
      this.onSelectionChange?.(this.#items[idx]!, idx);
    }
  }

  #ensureVisible(): void {
    if (this.#selectedIndex < this.#scrollOffset) {
      this.#scrollOffset = this.#selectedIndex;
    } else if (this.#selectedIndex >= this.#scrollOffset + this.#maxVisible) {
      this.#scrollOffset = this.#selectedIndex - this.#maxVisible + 1;
    }
  }

  invalidate(): void {}

  render(width: number): string[] {
    const result: string[] = [];

    if (this.#filter && this.#theme.filterText) {
      result.push(this.#theme.filterText(`/${this.#filter}`));
    }

    const visible = this.#filteredIndices.slice(
      this.#scrollOffset,
      this.#scrollOffset + this.#maxVisible,
    );

    for (let i = 0; i < visible.length; i++) {
      const idx = visible[i]!;
      const item = this.#items[idx]!;
      const isSelected = i === this.#selectedIndex - this.#scrollOffset;
      const prefix = isSelected ? "▸ " : "  ";
      const label = truncateToWidth(prefix + item.label, width);
      const line = isSelected ? this.#theme.selected(label) : label;
      result.push(line);
      if (item.description) {
        const desc = truncateToWidth("  " + item.description, Math.max(1, width - 2));
        result.push(this.#theme.description(desc));
      }
    }

    return result;
  }
}
