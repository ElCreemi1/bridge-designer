/* SPDX-License-Identifier: GPL-3.0-or-later */
import { Injectable } from '@angular/core';
import { jsPDF } from 'jspdf';
import { BridgeService } from '../../shared/services/bridge.service';
import { PastaSettingsService } from '../../shared/services/pasta-settings.service';
import { PastaStrandSessionService } from '../center-load/pasta-strand-session.service';
import { BUILD_MARGIN_MM, makePastaBuild, PastaBuild, pastaBuildTiles } from './pasta-build-layout';

/** A vector PDF construction booklet for ONE modeled pasta truss. */
@Injectable({ providedIn: 'root' })
export class PastaBuildPdfService {
  constructor(private readonly bridge: BridgeService, private readonly strands: PastaStrandSessionService,
    private readonly settings: PastaSettingsService) {}

  create(format: 'letter' | 'a4' = 'letter'): jsPDF {
    const b = this.bridge.bridge;
    const model = makePastaBuild(b.joints, b.members.map(m => ({ a: m.a.index, b: m.b.index, number: m.number })),
      this.strands.read(), this.bridge.designConditions.loadedJointCount, this.settings.maxStrandLengthM);
    const doc = new jsPDF({ unit: 'mm', format, orientation: 'landscape' });
    doc.setProperties({ title: 'Pasta bridge construction booklet' });
    const w = doc.internal.pageSize.getWidth(), h = doc.internal.pageSize.getHeight(), margin = BUILD_MARGIN_MM;
    const plan = pastaBuildTiles(model, w, h);
    plan.tiles.forEach((tile, index) => {
      if (index) doc.addPage();
      this.heading(doc, `FULL SIZE 1:1 - tile R${tile.row + 1} C${tile.column + 1} of ${plan.rows} rows x ${plan.columns} columns`);
      doc.setFontSize(7); doc.text(`Print ACTUAL SIZE / 100%, never Fit. Major grid 5 mm; minor grid ${model.gridMm} mm. Overlap 10 mm.`, margin, margin + 5);
      const top = margin + 12;
      doc.saveGraphicsState(); doc.rect(margin, top, tile.width, tile.height, null); doc.clip(); doc.discardPath();
      for (let gx = Math.ceil(tile.x / model.gridMm); gx * model.gridMm <= tile.x + tile.width + 1e-7; gx++) {
        const value = gx * model.gridMm, major = Math.abs(value / 5 - Math.round(value / 5)) < 1e-7;
        doc.setDrawColor(major ? 165 : 220, major ? 185 : 230, major ? 205 : 240);
        doc.setLineWidth(major ? 0.15 : 0.07); doc.line(margin + value - tile.x, top, margin + value - tile.x, top + tile.height);
      }
      for (let gy = Math.ceil(tile.y / model.gridMm); gy * model.gridMm <= tile.y + tile.height + 1e-7; gy++) {
        const value = gy * model.gridMm, major = Math.abs(value / 5 - Math.round(value / 5)) < 1e-7;
        doc.setDrawColor(major ? 165 : 220, major ? 185 : 230, major ? 205 : 240);
        doc.setLineWidth(major ? 0.15 : 0.07); doc.line(margin, top + value - tile.y, margin + tile.width, top + value - tile.y);
      }
      this.drawModel(doc, model, 1, margin - tile.x, top - tile.y, true);
      doc.restoreGraphicsState(); doc.setDrawColor(0); doc.setLineWidth(0.15); doc.rect(margin, top, tile.width, tile.height);
      for (const dx of [5, tile.width - 5]) for (const dy of [5, tile.height - 5]) {
        const x = margin + dx, y = top + dy;
        doc.line(x - 2, y, x + 2, y); doc.line(x, y - 2, x, y + 2);
        doc.setFontSize(5); doc.text(`${(tile.x + dx).toFixed(1)},${(tile.y + dy).toFixed(1)}`, x + 2, y - 1);
      }
      const barY = h - margin - 5;
      doc.setDrawColor(0); doc.setLineWidth(0.25); doc.line(margin, barY, margin + 100, barY);
      for (const dx of [0, 50, 100]) doc.line(margin + dx, barY - 1.5, margin + dx, barY + 1.5);
      doc.setFontSize(7); doc.text('Measure this bar: 100 mm. Match identical coordinate crosses when assembling.', margin, h - margin);
    });
    // Illustrated inventory: every member is listed, with the exact number of separate strands.
    for (let start = 0; start < model.parts.length; start += 8) {
      doc.addPage(); this.heading(doc, `PARTS INVENTORY - members ${start + 1}-${Math.min(start + 8, model.parts.length)}`);
      doc.setFontSize(7); doc.text('One modeled truss. Lengths are joint-center to joint-center; no glue, lap or cutting allowance. Illustrations are NOT full size.', margin, margin + 6);
      const cardW = (w - 2 * margin - 8) / 2, cardH = (h - 2 * margin - 24) / 4;
      model.parts.slice(start, start + 8).forEach((part, i) => {
        const x = margin + (i % 2) * (cardW + 8), y = margin + 12 + Math.floor(i / 2) * cardH;
        doc.setDrawColor(180); doc.setLineWidth(0.15); doc.rect(x, y, cardW, cardH - 2);
        doc.setTextColor(part.overLength ? 170 : 0, 0, 0); doc.setFontSize(10);
        doc.text(`M${part.number}   x${part.count} strands`, x + 4, y + 6);
        doc.setFontSize(8); doc.text(`J${part.a + 1} to J${part.b + 1}   ${part.lengthMm.toFixed(1)} mm (${(part.lengthMm / 10).toFixed(2)} cm)`, x + 4, y + 12);
        doc.setDrawColor(part.overLength ? 170 : 40, 40, 40); doc.setLineWidth(0.45);
        const length = Math.max(12, Math.min(cardW - 14, part.lengthMm * 0.3));
        for (let strand = 0; strand < Math.min(part.count, 4); strand++) doc.line(x + 5, y + 18 + strand * 1.4, x + 5 + length, y + 18 + strand * 1.4);
        doc.setTextColor(0); doc.setFontSize(7);
        doc.text(part.overLength ? `LONGER than ${model.maxStrandLengthMm.toFixed(0)} mm stock - redesign; no splice assumed.` : 'Cut quantity above; bundle only at the joints.', x + 4, y + cardH - 6);
      });
      doc.setFontSize(7); doc.text(`Total: ${model.totalPieces} separate pieces; ${(model.totalLengthMm / 1000).toFixed(3)} m of pasta, excluding waste.`, margin, h - margin);
    }
    doc.addPage(); this.heading(doc, 'BUILD OVERVIEW - reduced scale, NOT a cutting template');
    const minX = Math.min(...model.points.map(p => p.x)), maxX = Math.max(...model.points.map(p => p.x));
    const minY = Math.min(...model.points.map(p => p.y)), maxY = Math.max(...model.points.map(p => p.y));
    const scale = Math.min((w - 2 * margin - 16) / Math.max(1, maxX - minX), 85 / Math.max(1, maxY - minY));
    this.drawModel(doc, model, scale, margin + 8 - minX * scale, margin + 16 - minY * scale, false);
    doc.setTextColor(0); doc.setFontSize(8); doc.text('Exact strand counts per member (one modeled truss):', margin, 125);
    const columns = Math.max(1, Math.ceil(model.parts.length / 15));
    const columnW = (w - 2 * margin) / columns;
    doc.setFontSize(Math.min(8, Math.max(5, columnW / 2.2)));
    model.parts.forEach((part, i) => doc.text(`M${part.number} x${part.count}`, margin + Math.floor(i / 15) * columnW, 131 + (i % 15) * 4));
    doc.setFontSize(7); doc.text('Quantities are NOT doubled for two sides. Lateral bracing, hangers and glue are not included unless drawn as members.', margin, h - margin - 5);
    doc.text('Counts are the current session values, not a strength certification. Save this booklet before closing or loading another bridge.', margin, h - margin);
    const pages = doc.getNumberOfPages();
    for (let page = 1; page <= pages; page++) {
      doc.setPage(page); doc.setTextColor(0); doc.setFontSize(7); doc.text(`${page} / ${pages}`, w - margin, h - margin, { align: 'right' });
    }
    return doc;
  }
  private heading(doc: jsPDF, text: string): void {
    doc.setTextColor(0); doc.setFontSize(11); doc.text(text, BUILD_MARGIN_MM, BUILD_MARGIN_MM);
  }
  private drawModel(doc: jsPDF, model: PastaBuild, scale: number, tx: number, ty: number, fullSize: boolean): void {
    doc.setLineWidth(0.3); doc.setDrawColor(30); doc.setTextColor(0); doc.setFontSize(fullSize ? 6 : 7);
    model.parts.forEach((part, i) => {
      const a = model.points[part.a], b = model.points[part.b];
      const ax = tx + a.x * scale, ay = ty + a.y * scale, bx = tx + b.x * scale, by = ty + b.y * scale;
      doc.line(ax, ay, bx, by);
      const length = Math.hypot(bx - ax, by - ay), offset = (i % 2 ? 1 : -1) * 3;
      const x = (ax + bx) / 2 - (by - ay) / length * offset, y = (ay + by) / 2 + (bx - ax) / length * offset;
      const label = `M${part.number} x${part.count}`, width = doc.getTextWidth(label) + 1.2;
      doc.setDrawColor(160); doc.setLineWidth(0.1); doc.line((ax + bx) / 2, (ay + by) / 2, x, y);
      doc.setFillColor('white'); doc.rect(x - width / 2, y - 1.5, width, 3, 'F');
      doc.text(label, x, y, { align: 'center', baseline: 'middle' }); doc.setDrawColor(30); doc.setLineWidth(0.3);
    });
    model.points.forEach((point, i) => {
      const x = tx + point.x * scale, y = ty + point.y * scale;
      doc.setFillColor('white'); doc.circle(x, y, fullSize ? 0.7 : 0.5, 'FD');
      doc.setFontSize(5); doc.text(`J${i + 1}`, x + 1, y - 1); doc.setFontSize(fullSize ? 6 : 7);
    });
  }
}
