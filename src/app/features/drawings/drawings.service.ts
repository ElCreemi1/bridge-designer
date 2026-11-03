/* Copyright (c) 2025-2026 Gene Ressler
   SPDX-License-Identifier: GPL-3.0-or-later */

import { Injectable } from '@angular/core';
import { jsPDF } from 'jspdf';
import { BridgeService } from '../../shared/services/bridge.service';
import { PastaBuildPdfService } from './pasta-build-pdf.service';
import { EventBrokerService } from '../../shared/services/event-broker.service';
import { BridgePdfRenderingService } from './bridge-pdf-rendering.service';
import { MemberTablePdfRenderingService } from './member-table-pdf-rendering.service';
import { TitleBlockPdfRenderingService } from './title-block-pdf-rendering.service';

export const DRAWING_MARGIN_MM = 25.4 * 0.5;
export const DRAWING_LINE_WIDTH_MM = 0.1;
const DRAWING_SEPARATION = 25.4 * 0.3;

@Injectable({ providedIn: 'root' })
export class DrawingsService {
  private inAnimation = false;
  constructor(
    private readonly bridgePdfRenderingService: BridgePdfRenderingService,
    private readonly bridgeService: BridgeService,
    private readonly pastaBooklet: PastaBuildPdfService,
    eventBrokerService: EventBrokerService,
    private readonly memberTablePdfRenderingService: MemberTablePdfRenderingService,
    private readonly titleBlockPdfRenderingService: TitleBlockPdfRenderingService,
  ) {
    eventBrokerService.uiModeRequest.subscribe(info => { this.inAnimation = info.data === 'animation'; });
    eventBrokerService.printRequest.subscribe(() => {
      try { this.createPDF(); }
      catch (error) { window.alert(error instanceof Error ? error.message : String(error)); }
    });
  }

  public createPDF(): jsPDF {
    if (this.bridgeService.designConditions.isPasta) {
      if (this.inAnimation) throw new Error('Return to the drawing before exporting so the latest optimized strand counts are included.');
      const booklet = this.pastaBooklet.create();
      window.open(URL.createObjectURL(booklet.output('blob')), '_blank');
      return booklet;
    }
    const doc = new jsPDF({ format: 'letter', orientation: 'landscape' });
    // Becomes title of PDF preview window.
    doc.setProperties({title: 'Bridge Drawing'});

    // Render the first sheet.
    const drawingBottomY = this.bridgePdfRenderingService.draw(doc);
    const titleBlockTopY = this.titleBlockPdfRenderingService.draw(doc);
    let remainingRows = this.memberTablePdfRenderingService.drawFirstSheet(doc, drawingBottomY + DRAWING_SEPARATION, titleBlockTopY);

    // Render continuations of the member table while data still remains.
    let sheetNumber = 2;
    while (remainingRows.length > 0) {
      doc.addPage();
      const titleBlockTopY = this.titleBlockPdfRenderingService.draw(doc, "Main Truss Elevation (meters), continued", sheetNumber)
      remainingRows = this.memberTablePdfRenderingService.drawContinuationSheet(doc, remainingRows, titleBlockTopY);
    }

    // Build a PDF file and preview it. Assumes the browser has a PDF viewer linked to the MIME type.
    const blob = doc.output('blob');
    // This makes a funky random string. Specifying the name requires a hack that doesn't look robust.
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    return doc;
  }
}
