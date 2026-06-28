/**
 * ContextMenu — a lightweight cursor-positioned menu. Data-driven by an items array so callers
 * (the library track menu, etc.) just describe actions. Dismisses on outside click, Esc, or
 * after an action. Supports nested submenus and separators.
 */

import { useEffect, useRef, useState } from 'react';

export interface MenuItem {
  /** Visible text. Omit only for a separator. */
  label?: string;
  /** Action to run on click. Omit for a submenu (provide `items`) or a separator. */
  onClick?: () => void;
  /** Nested submenu. */
  items?: MenuItem[];
  /** Render a divider; ignore other fields. */
  separator?: boolean;
  disabled?: boolean;
  /** Small leading glyph/icon. */
  icon?: string;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

function MenuList({ items, onClose }: { items: MenuItem[]; onClose: () => void }): React.JSX.Element {
  const [openSub, setOpenSub] = useState<number | null>(null);
  return (
    <ul className="ctx-menu" role="menu">
      {items.map((it, i) =>
        it.separator ? (
          <li key={i} className="ctx-sep" role="separator" />
        ) : (
          <li
            key={i}
            className={`ctx-item${it.disabled ? ' disabled' : ''}${it.items ? ' has-sub' : ''}`}
            role="menuitem"
            aria-disabled={it.disabled}
            onMouseEnter={() => setOpenSub(it.items ? i : null)}
            onClick={(e) => {
              if (it.disabled) return;
              if (it.items) return; // submenu opens on hover, not click
              e.stopPropagation();
              it.onClick?.();
              onClose();
            }}
          >
            {it.icon && <span className="ctx-icon">{it.icon}</span>}
            <span className="ctx-label">{it.label}</span>
            {it.items && <span className="ctx-arrow">›</span>}
            {it.items && openSub === i && (
              <div className="ctx-submenu">
                <MenuList items={it.items} onClose={onClose} />
              </div>
            )}
          </li>
        ),
      )}
    </ul>
  );
}

export function ContextMenu({
  state,
  onClose,
}: {
  state: ContextMenuState | null;
  onClose: () => void;
}): React.JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // defer so the opening right-click doesn't immediately close it
    const t = setTimeout(() => {
      window.addEventListener('mousedown', onDown);
      window.addEventListener('keydown', onKey);
      window.addEventListener('contextmenu', onDown, true);
    }, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('contextmenu', onDown, true);
    };
  }, [state, onClose]);

  if (!state) return null;

  // keep the menu on-screen (flip near the right/bottom edges)
  const MENU_W = 220;
  const x = Math.min(state.x, window.innerWidth - MENU_W - 8);
  const y = Math.min(state.y, window.innerHeight - 320);

  return (
    <div ref={ref} className="ctx-root" style={{ left: x, top: y }}>
      <MenuList items={state.items} onClose={onClose} />
    </div>
  );
}
