/* Copyright (c) 2025-2026 Gene Ressler
   SPDX-License-Identifier: GPL-3.0-or-later */

/** Smallest dialog scale; below this, text is too small to read and the dialog scrolls instead. */
const MIN_DIALOG_ZOOM = 0.45;
const MARGIN_PX = 8;

/** Natural size of a jqxWindow from its inline pixel dimensions, falling back to its content size. */
function naturalSize(win: HTMLElement): { width: number; height: number } {
  const width = parseFloat(win.style.width) || win.scrollWidth;
  const height = parseFloat(win.style.height) || win.scrollHeight;
  return { width, height };
}

/**
 * Scales each visible fixed-size jqxWindow dialog so it fits the visual viewport,
 * instead of clipping it on short landscape phone screens. Uses CSS zoom so touch
 * targets scale with the drawing.
 */
export function fitDialogsToViewport(): void {
  patchListBoxHitTest();
  const viewport = window.visualViewport;
  const availableWidth = (viewport?.width ?? window.innerWidth) - 2 * MARGIN_PX;
  const availableHeight = (viewport?.height ?? window.innerHeight) - 2 * MARGIN_PX;
  document.querySelectorAll<HTMLElement>('.jqx-window').forEach(win => {
    if (getComputedStyle(win).display === 'none') return;
    const { width, height } = naturalSize(win);
    if (!(width > 0 && height > 0)) return;
    const zoom = Math.max(MIN_DIALOG_ZOOM, Math.min(1, availableWidth / width, availableHeight / height));
    const zoomed = zoom < 0.999;
    // jqxWindow laid out its inner wrapper, header and content while the touch CSS clamped
    // the window, so they keep a clipped size. Recompute them from the natural size, keeping
    // jqxWindow's own spacing between them (recorded before the first change).
    const wrapper = win.querySelector<HTMLElement>(':scope > .jqx-resize');
    const box = wrapper ?? win;
    const header = box.querySelector<HTMLElement>(':scope > .jqx-window-header');
    const content = box.querySelector<HTMLElement>(':scope > .jqx-window-content');
    const px = (el: HTMLElement | null, prop: 'width' | 'height') => (el ? parseFloat(el.style[prop]) : NaN);
    if (zoomed && win.dataset['touchFit'] !== '1') {
      const boxWidth = wrapper ? px(wrapper, 'width') : width, boxHeight = wrapper ? px(wrapper, 'height') : height;
      win.dataset['touchHeaderInset'] = String(boxWidth - (px(header, 'width') || boxWidth));
      win.dataset['touchContentInsetW'] = String(boxWidth - (px(content, 'width') || boxWidth));
      win.dataset['touchContentInsetH'] = String(boxHeight - (px(content, 'height') || boxHeight));
    }
    const inset = (key: string) => Math.max(0, parseFloat(win.dataset[key] ?? '0') || 0);
    const boxWidth = width - 2, boxHeight = height - 2;
    const size = (value: number) => (zoomed && value > 0 ? `${Math.round(value)}px` : '');
    const edits: [HTMLElement | null, string, string][] = [
      [win, 'zoom', zoomed ? zoom.toFixed(3) : ''],
      // At minimum scale a dialog can still be too tall; let it scroll inside the screen.
      [win, 'max-height', zoomed ? `${Math.floor(availableHeight / zoom)}px` : ''],
      [win, 'overflow', zoomed ? 'auto' : ''],
      [wrapper, 'width', size(boxWidth)],
      [wrapper, 'height', size(boxHeight)],
      [header, 'width', header && !Number.isNaN(px(header, 'width')) ? size(boxWidth - inset('touchHeaderInset')) : ''],
      [content, 'width', size(boxWidth - inset('touchContentInsetW'))],
      [content, 'height', size(boxHeight - inset('touchContentInsetH'))],
    ];
    for (const [element, property, value] of edits) {
      if (!element) continue;
      const current = element.style.getPropertyValue(property);
      const ours = element.dataset['touchFit'] === '1';
      // jQWidgets styles force zoom: 1 !important on widgets; only an inline !important overrides it.
      if (value && (current !== value || element.style.getPropertyPriority(property) !== 'important')) {
        element.style.setProperty(property, value, 'important');
      } else if (!value && ours && element.style.getPropertyPriority(property) === 'important') {
        element.style.removeProperty(property);
      }
    }
    for (const element of [win, wrapper, header, content]) if (element) element.dataset['touchFit'] = zoomed ? '1' : '';
    win.classList.toggle('touch-fit-zoomed', zoomed);
  });
}

/** Visual scale of an element: its on-screen height over its layout height. */
function visualScale(element: Element | undefined): number {
  const el = element as HTMLElement | undefined;
  if (!el || !el.offsetHeight) return 1;
  const scale = el.getBoundingClientRect().height / el.offsetHeight;
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

type HitTestHost = { host?: { [0]?: Element } };
let listBoxPatched = false;
/**
 * jqxListBox converts a tap position (measured on screen) to an item index using layout
 * row heights, so in a scaled dialog it selects the wrong row. Convert to layout units first.
 */
function patchListBoxHitTest(): void {
  if (listBoxPatched) return;
  const framework = (window as unknown as { jqxBaseFramework?: { jqx?: Record<string, { prototype?: Record<string, unknown> }> } })
    .jqxBaseFramework;
  const prototype = framework?.jqx?.['_jqxListBox']?.prototype;
  const original = prototype?.['_hitTest'] as ((this: HitTestHost, x: number, y: number) => unknown) | undefined;
  if (!prototype || typeof original !== 'function') return;
  prototype['_hitTest'] = function (this: HitTestHost, x: number, y: number) {
    const scale = visualScale(this.host?.[0]);
    return original.call(this, x / scale, y / scale);
  };
  listBoxPatched = true;
}

let fitFrame: number | undefined;
function scheduleFit(): void {
  if (fitFrame !== undefined) return;
  fitFrame = requestAnimationFrame(() => {
    fitFrame = undefined;
    fitDialogsToViewport();
  });
}

/** True when the page is running as an installed Home Screen app. */
export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * Enters full screen and locks landscape where the browser allows it (Android Chrome).
 * iOS Safari supports neither for pages, so this quietly does nothing there.
 * Must be called from a user gesture.
 */
export async function enterLandscapeFullscreen(): Promise<void> {
  try {
    const root = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
    if (!document.fullscreenElement && !isStandalone()) {
      if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' });
      else await root.webkitRequestFullscreen?.();
    }
  } catch { /* Not allowed here; continue without full screen. */ }
  try {
    const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await orientation.lock?.('landscape');
  } catch { /* Not supported or not in full screen. */ }
}

export function exitLandscapeFullscreen(): void {
  try { (screen.orientation as ScreenOrientation & { unlock?: () => void }).unlock?.(); } catch { /* Optional. */ }
  if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
}

/** With ?diag in the URL, shows live layout measurements to help diagnose phone rendering. */
function installDiagnostics(): void {
  if (!new URLSearchParams(window.location.search).has('diag')) return;
  const box = document.createElement('pre');
  box.setAttribute('aria-hidden', 'true');
  box.style.cssText = 'position:fixed;right:4px;bottom:4px;z-index:2147483647;margin:0;padding:4px 6px;' +
    'max-width:60vw;background:rgba(0,0,0,.78);color:#0f0;font:10px/1.25 monospace;white-space:pre-wrap;pointer-events:none;';
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;font-size:16px;line-height:normal;width:300px;';
  probe.textContent = 'Probe text for font scaling, long enough to be a wide block of text in the page.';
  document.body.append(box, probe);
  const update = () => {
    const vv = window.visualViewport;
    const lines = [
      `build: touch-fit-2`,
      `inner ${window.innerWidth}x${window.innerHeight} vv ${Math.round(vv?.width ?? 0)}x${Math.round(vv?.height ?? 0)} s${(vv?.scale ?? 1).toFixed(2)} dpr ${devicePixelRatio}`,
      `font16→${getComputedStyle(probe).fontSize} fs=${!!document.fullscreenElement} ${screen.orientation?.type ?? ''}`,
      `coarse=${matchMedia('(pointer: coarse)').matches} any=${matchMedia('(any-pointer: coarse)').matches} tp=${navigator.maxTouchPoints}`,
      navigator.userAgent.replace(/^Mozilla\/5\.0 /, '').slice(0, 120),
    ];
    document.querySelectorAll<HTMLElement>('.jqx-window').forEach(win => {
      if (getComputedStyle(win).display === 'none') return;
      const content = win.querySelector<HTMLElement>('.jqx-window-content');
      const r = win.getBoundingClientRect();
      lines.push(`dlg "${(win.querySelector('.jqx-window-header')?.textContent ?? '').trim().slice(0, 24)}" ` +
        `${win.style.width}x${win.style.height} zoom ${getComputedStyle(win).zoom} rect ${Math.round(r.width)}x${Math.round(r.height)} ` +
        `content ${content?.style.width}x${content?.style.height} off ${content?.offsetWidth}x${content?.offsetHeight}`);
    });
    box.textContent = lines.join('\n');
  };
  setInterval(update, 1000);
  update();
}

/** Installs touch-only web behaviors: the touch-device marker class and dialog fitting. */
export function installTouchWebSupport(): void {
  document.documentElement.classList.add('touch-port');
  new MutationObserver(scheduleFit).observe(document.body, {
    subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class'],
  });
  window.addEventListener('resize', scheduleFit);
  window.visualViewport?.addEventListener('resize', scheduleFit);
  screen.orientation?.addEventListener?.('change', scheduleFit);
  scheduleFit();
  installDiagnostics();
}
