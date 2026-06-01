import { GAME_VIEWPORT_HEIGHT, GAME_VIEWPORT_WIDTH } from "./types";

export type ViewportLayout = {
  displayWidth: number;
  displayHeight: number;
};

export function computeViewportLayout(
  containerWidth: number,
  containerHeight: number,
): ViewportLayout | null {
  if (containerWidth <= 0 || containerHeight <= 0) return null;

  const scale = Math.min(
    containerWidth / GAME_VIEWPORT_WIDTH,
    containerHeight / GAME_VIEWPORT_HEIGHT,
  );
  return {
    displayWidth: Math.floor(GAME_VIEWPORT_WIDTH * scale),
    displayHeight: Math.floor(GAME_VIEWPORT_HEIGHT * scale),
  };
}

/** Keep canvas at fixed logical resolution; scale display size with CSS only. */
export function applyCanvasViewport(
  canvas: HTMLCanvasElement,
  layout: ViewportLayout,
): void {
  canvas.width = GAME_VIEWPORT_WIDTH;
  canvas.height = GAME_VIEWPORT_HEIGHT;
  canvas.style.width = `${layout.displayWidth}px`;
  canvas.style.height = `${layout.displayHeight}px`;
}

export function isPortraitMobile(): boolean {
  return window.matchMedia("(orientation: portrait) and (max-width: 900px)").matches;
}

export function tryLockLandscape(): void {
  const orientation = screen.orientation as ScreenOrientation & {
    lock?: (orientation: string) => Promise<void>;
  };
  void orientation.lock?.("landscape").catch(() => {});
}
