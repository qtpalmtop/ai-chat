/**
 * useOrientation：监听横竖屏变化
 * - 通过 window.matchMedia('(orientation: portrait)') 监听
 * - 解决"横屏时布局错乱"问题
 *
 * 用法：
 *   const { isPortrait, isLandscape } = useOrientation();
 *   return isLandscape ? <HorizontalLayout /> : <VerticalLayout />;
 */
import { useEffect, useState } from 'react';

export type Orientation = 'portrait' | 'landscape';

function detect(): Orientation {
  if (typeof window === 'undefined') return 'portrait';
  if (window.matchMedia) {
    if (window.matchMedia('(orientation: landscape)').matches) return 'landscape';
    if (window.matchMedia('(orientation: portrait)').matches) return 'portrait';
  }
  // 兜底：用 innerWidth/innerHeight
  return window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait';
}

export function useOrientation(): { orientation: Orientation; isPortrait: boolean; isLandscape: boolean } {
  const [orientation, setOrientation] = useState<Orientation>(detect);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const mql = window.matchMedia('(orientation: portrait)');
    const handler = () => setOrientation(detect());
    // Safari < 14 用 addListener，新版用 addEventListener
    if (mql.addEventListener) {
      mql.addEventListener('change', handler);
    } else {
      mql.addListener(handler);
    }

    // 兜底：window.resize
    window.addEventListener('resize', handler);

    return () => {
      if (mql.removeEventListener) {
        mql.removeEventListener('change', handler);
      } else {
        mql.removeListener(handler);
      }
      window.removeEventListener('resize', handler);
    };
  }, []);

  return {
    orientation,
    isPortrait: orientation === 'portrait',
    isLandscape: orientation === 'landscape',
  };
}
