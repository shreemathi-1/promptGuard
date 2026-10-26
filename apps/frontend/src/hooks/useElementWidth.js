import { useEffect, useRef, useState } from 'react';

/**
 * Tracks an element's rendered width, so SVG charts can lay out in real
 * pixels (text stays 11–12px instead of scaling with a viewBox).
 *
 * @returns {[React.RefObject, number]} ref to attach, current width (0 until measured)
 */
export default function useElementWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}
