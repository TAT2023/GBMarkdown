import { useLayoutEffect, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { native } from '../services/document-api';

export function useTheme(theme: string, ready: boolean, onError: (message: string) => void) {
  const applied = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const nativeUpdate = useRef(Promise.resolve());

  useLayoutEffect(() => {
    if (!ready || applied.current === theme) return;
    const root = document.documentElement;
    clearTimeout(timer.current);
    if (applied.current !== null && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      root.dataset.themeTransition = '';
      // Establish the old palette before changing the transition's target colors.
      getComputedStyle(root).backgroundColor;
      timer.current = setTimeout(() => { delete root.dataset.themeTransition; }, 280);
    } else {
      delete root.dataset.themeTransition;
    }
    root.dataset.theme = theme;
    applied.current = theme;
    if (native) {
      nativeUpdate.current = nativeUpdate.current.then(async () => {
        if (applied.current === theme) await getCurrentWindow().setTheme(theme === 'dark' ? 'dark' : 'light');
      }).catch(e => onError(`标题栏主题切换失败：${String(e)}`));
    }
  }, [theme, ready, onError]);

  useLayoutEffect(() => () => {
    clearTimeout(timer.current);
    delete document.documentElement.dataset.themeTransition;
  }, []);
}
