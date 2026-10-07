// The underline of a tab strip that slides to the selected tab instead of
// jumping. Measures the selected [role="tab"] inside `ref` and returns the
// inline style of the ink; the strip positions it absolutely. Re-measures on
// resize and when the fonts land (a serif title can shift the row).
import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

export function useTabInk(ref: RefObject<HTMLElement>, active: string): CSSProperties {
  const [ink, setInk] = useState<CSSProperties>({ opacity: 0 });
  useLayoutEffect(() => {
    const strip = ref.current;
    if (!strip) return;
    const measure = () => {
      const el = strip.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      if (!el) return setInk({ opacity: 0 });
      setInk({ opacity: 1, transform: `translateX(${el.offsetLeft}px)`, width: el.offsetWidth });
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(strip);
    void document.fonts?.ready.then(measure);
    return () => ro?.disconnect();
  }, [ref, active]);
  return ink;
}
