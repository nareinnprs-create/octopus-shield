import type { BrowserPageZoomCommand } from '../../../../../shared/browser-page-zoom'

export type { BrowserPageZoomCommand } from '../../../../../shared/browser-page-zoom'

export const OSHIELD_BROWSER_PAGE_ZOOM_EVENT = 'shield:browser-page-zoom'

export type BrowserPageZoomIndicatorState = {
  ariaHidden: boolean
  opacityClassName: 'opacity-100' | 'opacity-0'
}

export function getBrowserPageZoomIndicatorState({
  feedbackVisible
}: {
  feedbackVisible: boolean
}): BrowserPageZoomIndicatorState {
  // Show zoom only as transient feedback; non-default zoom must not leave a permanent badge.
  return {
    ariaHidden: !feedbackVisible,
    opacityClassName: feedbackVisible ? 'opacity-100' : 'opacity-0'
  }
}

/** Zoom chords that land in Shield's own window while a browser pane holds focus. */
export function dispatchBrowserPageZoom(command: BrowserPageZoomCommand): void {
  window.dispatchEvent(new CustomEvent(OSHIELD_BROWSER_PAGE_ZOOM_EVENT, { detail: command }))
}

export function addBrowserPageZoomEventListener(
  callback: (command: BrowserPageZoomCommand) => void
): () => void {
  const listener = (event: Event): void => {
    if (event instanceof CustomEvent) {
      callback(event.detail)
    }
  }
  window.addEventListener(OSHIELD_BROWSER_PAGE_ZOOM_EVENT, listener)
  return () => window.removeEventListener(OSHIELD_BROWSER_PAGE_ZOOM_EVENT, listener)
}
