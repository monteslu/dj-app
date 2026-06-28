/**
 * PromptModal — a small in-app text/confirm dialog. Electron renderers don't support
 * window.prompt()/confirm(), so playlist naming, renaming, and delete-confirm use this.
 * Driven by a `usePrompt()` hook that returns a function + the modal element to render.
 */

import { useCallback, useRef, useState } from 'react';

interface PromptOpts {
  title: string;
  /** Initial input value; omit for a yes/no confirm (no text field). */
  initial?: string;
  okLabel?: string;
  placeholder?: string;
  /** When true, no text field — just a confirm. resolve(true/null). */
  confirm?: boolean;
}

interface PromptReq extends PromptOpts {
  resolve: (value: string | null) => void;
}

export function usePrompt(): {
  prompt: (opts: PromptOpts) => Promise<string | null>;
  modal: React.JSX.Element | null;
} {
  const [req, setReq] = useState<PromptReq | null>(null);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const prompt = useCallback((opts: PromptOpts) => {
    setValue(opts.initial ?? '');
    return new Promise<string | null>((resolve) => {
      setReq({ ...opts, resolve });
      // focus after paint
      setTimeout(() => inputRef.current?.select(), 0);
    });
  }, []);

  const close = (result: string | null) => {
    req?.resolve(result);
    setReq(null);
  };

  const modal = req ? (
    <div className="modal-backdrop" onClick={() => close(null)}>
      <div className="prompt-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{req.title}</h3>
        {!req.confirm && (
          <input
            ref={inputRef}
            value={value}
            placeholder={req.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && value.trim()) close(value.trim());
              if (e.key === 'Escape') close(null);
            }}
          />
        )}
        <div className="prompt-actions">
          <button className="tiny" onClick={() => close(null)}>
            Cancel
          </button>
          <button
            className="tiny prompt-ok"
            disabled={!req.confirm && !value.trim()}
            onClick={() => close(req.confirm ? 'yes' : value.trim())}
          >
            {req.okLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { prompt, modal };
}
