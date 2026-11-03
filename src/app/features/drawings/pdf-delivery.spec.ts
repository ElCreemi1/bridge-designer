/* SPDX-License-Identifier: GPL-3.0-or-later */
import { deliverPdf } from './pdf-delivery';
import type { jsPDF } from 'jspdf';

describe('PDF delivery', () => {
  const pdf = { output: (type: string) => type === 'blob' ? new Blob(['%PDF-test'], { type: 'application/pdf' }) : 'data:application/pdf;base64,JVBERi10ZXN0' } as Pick<jsPDF, 'output'>;
  const host = window as Window & { Capacitor?: unknown };
  let previous: unknown;
  beforeEach(() => { previous = host.Capacitor; });
  afterEach(() => { host.Capacitor = previous; });
  it('writes binary PDF to cache then shares the returned native URI, without opening a tab', async () => {
    const calls: { plugin: string; method: string; args: Record<string, unknown> }[] = [];
    host.Capacitor = { getPlatform: () => 'android', nativePromise: async (plugin: string, method: string, args: Record<string, unknown>) => {
      calls.push({ plugin, method, args }); return plugin === 'Filesystem' ? { uri: 'file:///cache/booklet.pdf' } : {};
    } };
    const open = spyOn(window, 'open');
    await deliverPdf(pdf, 'pasta-booklet.pdf');
    expect(open).not.toHaveBeenCalled(); expect(calls.length).toBe(2);
    expect(calls[0].plugin).toBe('Filesystem'); expect(calls[0].method).toBe('writeFile');
    expect(calls[0].args['directory']).toBe('CACHE'); expect(calls[0].args['data']).toBe('JVBERi10ZXN0');
    expect(calls[0].args['encoding']).toBeUndefined();
    expect(calls[1].plugin).toBe('Share'); expect(calls[1].args['files']).toEqual(['file:///cache/booklet.pdf']);
  });
  it('does not silently use browser popups if the Android bridge is missing', async () => {
    host.Capacitor = { getPlatform: () => 'android' };
    await expectAsync(deliverPdf(pdf, 'test.pdf')).toBeRejectedWithError(/bridge is unavailable/);
  });
  it('reports write and share failures', async () => {
    host.Capacitor = { getPlatform: () => 'android', nativePromise: async () => { throw new Error('disk failure'); } };
    await expectAsync(deliverPdf(pdf, 'test.pdf')).toBeRejectedWithError(/Could not save.*disk failure/);
    host.Capacitor = { getPlatform: () => 'android', nativePromise: async (plugin: string) => {
      if (plugin === 'Filesystem') return { uri: 'file:///cache/booklet.pdf' }; throw new Error('share failure');
    } };
    await expectAsync(deliverPdf(pdf, 'test.pdf')).toBeRejectedWithError(/PDF was created.*share failure/);
  });
  it('rejects invalid native URIs before sharing', async () => {
    host.Capacitor = { getPlatform: () => 'android', nativePromise: async () => ({ uri: 'blob:invalid' }) };
    await expectAsync(deliverPdf(pdf, 'test.pdf')).toBeRejectedWithError(/file URI/);
  });
  it('uses a named download if a web popup is blocked', async () => {
    host.Capacitor = undefined;
    spyOn(window, 'open').and.returnValue(null);
    const click = spyOn(HTMLAnchorElement.prototype, 'click');
    spyOn(URL, 'createObjectURL').and.returnValue('blob:test');
    spyOn(window, 'setTimeout');
    await deliverPdf(pdf, 'bridge-drawing.pdf');
    expect(click).toHaveBeenCalled();
  });
});
