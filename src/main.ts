/* Copyright (c) 2025-2026 Gene Ressler
   SPDX-License-Identifier: GPL-3.0-or-later */

import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { areBrowserFeaturesMissing, BROWSER_FEATURES } from './app/features/browser/browser-checks';

/** Removes watermarks from jqWidgets. */
jqx.credits = '71208878-FCD1-4EC7-9249-BA0F153A5DE8';

// Capacitor injects this bridge in the native WebView. Do not classify an ordinary
// Android browser as native merely because its user agent contains Android.
const bridge = (window as Window & {
  Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
}).Capacitor;
const isNativeAndroid = bridge?.isNativePlatform?.() === true && bridge?.getPlatform?.() === 'android';

// Touch devices (phones and tablets, including iOS Safari) run the experimental
// touch port on the web as well. Like the native app, they skip the desktop-only
// mouse, 1280x720 screen and browser-brand checks but keep genuine runtime checks.
const isTouchPrimary = window.matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0;

function bootstrap(): void {
  bootstrapApplication(AppComponent, appConfig).catch((err: unknown) => console.error(err));
}

if (isNativeAndroid || isTouchPrimary) {
  // A previous desktop-help redirect must not become the app's asset base.
  const infoPath = /\/browserinfo\/?$/;
  if (infoPath.test(window.location.pathname)) {
    window.history.replaceState(window.history.state, '',
      window.location.pathname.replace(infoPath, '/') + window.location.search + window.location.hash);
  }
  const required = [
    'addEventListener', 'async', 'canvas', 'classList', 'localStorage',
    'querySelectorAll', 'viewportUnits', 'webgl2',
  ] as const;
  const missing = required.filter(feature => !BROWSER_FEATURES[feature]);
  if (missing.length > 0) {
    const message = 'This browser is missing required capabilities: ' + missing.join(', ');
    if (isNativeAndroid) throw new Error(message);
    alert(message + '. Bridge Designer may not work correctly.');
  }
  bootstrap();
} else if (areBrowserFeaturesMissing()) {
  window.location.replace('browserinfo/');
} else {
  bootstrap();
}
