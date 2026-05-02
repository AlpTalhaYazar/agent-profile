import * as React from "react";

export interface UseRovingTabIndexOptions<T extends HTMLElement> {
  count: number;
  orientation: "vertical" | "horizontal";
  loop?: boolean;
  onActivate?: (index: number) => void;
}

export interface RovingItemProps<T extends HTMLElement> {
  ref: (node: T | null) => void;
  tabIndex: number;
  onFocus: () => void;
  onKeyDown: (event: React.KeyboardEvent<T>) => void;
}

export function useRovingTabIndex<T extends HTMLElement>({
  count,
  orientation,
  loop = true,
  onActivate,
}: UseRovingTabIndexOptions<T>): {
  activeIndex: number;
  setActiveIndex: React.Dispatch<React.SetStateAction<number>>;
  getItemProps: (index: number) => RovingItemProps<T>;
} {
  const [activeIndex, setActiveIndex] = React.useState(0);
  const refs = React.useRef<Array<T | null>>([]);

  React.useEffect(() => {
    if (count === 0) {
      setActiveIndex(0);
      return;
    }
    setActiveIndex((current) => Math.min(current, count - 1));
  }, [count]);

  const focusIndex = React.useCallback(
    (nextIndex: number) => {
      if (count === 0) return;
      const bounded = loop
        ? (nextIndex + count) % count
        : Math.max(0, Math.min(nextIndex, count - 1));
      setActiveIndex(bounded);
      refs.current[bounded]?.focus();
      window.requestAnimationFrame(() => refs.current[bounded]?.focus());
    },
    [count, loop]
  );

  const getItemProps = React.useCallback(
    (index: number): RovingItemProps<T> => ({
      ref: (node: T | null) => {
        refs.current[index] = node;
      },
      tabIndex: index === activeIndex ? 0 : -1,
      onFocus: () => setActiveIndex(index),
      onKeyDown: (event: React.KeyboardEvent<T>) => {
        const previousKey = orientation === "vertical" ? "ArrowUp" : "ArrowLeft";
        const nextKey = orientation === "vertical" ? "ArrowDown" : "ArrowRight";
        if (event.key === previousKey) {
          event.preventDefault();
          focusIndex(index - 1);
          return;
        }
        if (event.key === nextKey) {
          event.preventDefault();
          focusIndex(index + 1);
          return;
        }
        if (event.key === "Home") {
          event.preventDefault();
          focusIndex(0);
          return;
        }
        if (event.key === "End") {
          event.preventDefault();
          focusIndex(count - 1);
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onActivate?.(index);
        }
      },
    }),
    [activeIndex, count, focusIndex, onActivate, orientation]
  );

  return { activeIndex, setActiveIndex, getItemProps };
}
