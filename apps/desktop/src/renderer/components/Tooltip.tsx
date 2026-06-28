/**
 * Tooltip — a single app-wide custom tooltip. The native `title` tooltip is unreliable in
 * this app: a continuously-running requestAnimationFrame loop (waveforms, VU meters, the SAB
 * pump) keeps Chromium in constant "activity", which suppresses/flashes the native title
 * popup. This replaces it: on hover of any element carrying a `title`, we move that text to a
 * `data-tip` attribute (so the native tooltip never fires) and show our own styled bubble
 * after a short delay. One listener on the document, one floating element.
 *
 * Mount once near the app root. Existing `title="…"` attributes work as-is; no per-element
 * changes needed.
 */

import { useEffect, useRef, useState } from 'react';

interface TipState {
  text: string;
  x: number;
  y: number;
}

const SHOW_DELAY = 450; // ms hover before showing (matches native feel)

export function Tooltip(): React.JSX.Element | null {
  const [tip, setTip] = useState<TipState | null>(null);
  const elRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const clear = () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };

    const hide = () => {
      clear();
      // restore the title we stashed so the attribute round-trips
      const t = targetRef.current;
      if (t && t.dataset.tip != null) {
        t.title = t.dataset.tip;
        delete t.dataset.tip;
      }
      targetRef.current = null;
      setTip(null);
    };

    const onOver = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('[title], [data-tip]');
      if (!el) {
        if (targetRef.current) hide();
        return;
      }
      if (el === targetRef.current) return; // already on this element
      hide();
      const text = el.title || el.dataset.tip || '';
      if (!text) return;
      targetRef.current = el;
      // stash + strip the native title so the OS tooltip never competes
      el.dataset.tip = text;
      el.removeAttribute('title');
      clear();
      timer.current = window.setTimeout(() => {
        const r = el.getBoundingClientRect();
        setTip({ text, x: r.left + r.width / 2, y: r.bottom + 6 });
      }, SHOW_DELAY);
    };

    const onOut = (e: MouseEvent) => {
      const to = e.relatedTarget as Node | null;
      if (targetRef.current && (!to || !targetRef.current.contains(to))) hide();
    };

    // capture phase so we see events before they're stopped, passive (we don't preventDefault)
    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('mouseout', onOut, true);
    window.addEventListener('blur', hide);
    return () => {
      document.removeEventListener('mouseover', onOver, true);
      document.removeEventListener('mouseout', onOut, true);
      window.removeEventListener('blur', hide);
      hide();
    };
  }, []);

  if (!tip) return null;

  // keep on screen horizontally; the bubble is centered on the target via translateX(-50%)
  const x = Math.max(8, Math.min(tip.x, window.innerWidth - 8));
  const y = Math.min(tip.y, window.innerHeight - 8);
  return (
    <div ref={elRef} className="app-tooltip" style={{ left: x, top: y }} role="tooltip">
      {tip.text}
    </div>
  );
}
