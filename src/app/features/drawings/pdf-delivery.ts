/* SPDX-License-Identifier: GPL-3.0-or-later */
import type { jsPDF } from 'jspdf';

type NativeRuntime = {
  getPlatform?: () => string;
  nativePromise?: (plugin: string, method: string, options: Record<string, unknown>) => Promise<unknown>;
};

/** Native Capacitor bridge is injected by the APK; web builds need no native imports.
 * Files remain in app cache so the receiving application can read them after sharing.
 */
export async function deliverPdf(pdf: Pick<jsPDF, 'output'>, filename: string): Promise<void> {
  const runtime = (window as Window & { Capacitor?: NativeRuntime }).Capacitor;
  if (runtime?.getPlatform?.() === 'android') {
    if (!runtime.nativePromise) throw new Error('Android PDF bridge is unavailable. Install an APK built with PDF sharing support.');
    const data = pdf.output('datauristring');
    const marker = ';base64,', index = data.indexOf(marker);
    if (index < 0 || !data.slice(index + marker.length)) throw new Error('PDF generation returned no binary data.');
    const path = `bridge-pdfs/${Date.now()}-${Math.random().toString(36).slice(2)}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    let saved: unknown;
    try {
      saved = await runtime.nativePromise('Filesystem', 'writeFile', {
        path, directory: 'CACHE', data: data.slice(index + marker.length), recursive: true,
      });
    } catch (error) {
      throw new Error(`Could not save the PDF in Android app cache: ${error instanceof Error ? error.message : String(error)}`);
    }
    const uri = (saved as { uri?: unknown } | null)?.uri;
    if (typeof uri !== 'string' || !uri.startsWith('file://')) throw new Error('Android did not return a shareable PDF file URI.');
    try {
      await runtime.nativePromise('Share', 'share', { title: 'Bridge drawing PDF', dialogTitle: 'Open or share bridge PDF', files: [uri] });
    } catch (error) {
      throw new Error(`The PDF was created, but Android sharing did not complete: ${error instanceof Error ? error.message : String(error)}`);
    }
    return;
  }
  const url = URL.createObjectURL(pdf.output('blob'));
  try {
    const viewer = window.open(url, '_blank');
    if (!viewer) {
      const link = document.createElement('a');
      link.href = url; link.download = filename;
      document.body.appendChild(link);
      try { link.click(); } finally { link.remove(); }
    }
  } finally {
    // Keep the object URL alive long enough for the viewer/download to consume it.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}
