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

if (isNativeAndroid) {
  // A previous desktop-help redirect must not become the native app's asset base.
  if (/^\/browserinfo(?:\/|$)/.test(window.location.pathname)) {
    window.history.replaceState(window.history.state, '', '/' + window.location.search + window.location.hash);
  }
  // Mouse, desktop screen dimensions, and browser branding are not hardware
  // prerequisites for the experimental touch port. Keep genuine runtime checks.
  const required = [
    'addEventListener', 'async', 'canvas', 'classList', 'localStorage',
    'querySelectorAll', 'viewportUnits', 'webgl2',
  ] as const;
  const missing = required.filter(feature => !BROWSER_FEATURES[feature]);
  if (missing.length > 0) {
    throw new Error('Android WebView is missing required capabilities: ' + missing.join(', '));
  }
  bootstrapApplication(AppComponent, appConfig).catch((err: unknown) => console.error(err));
} else if (areBrowserFeaturesMissing()) {
  window.location.replace('browserinfo/');
} else {
  bootstrapApplication(AppComponent, appConfig).catch((err: unknown) => console.error(err));
}
