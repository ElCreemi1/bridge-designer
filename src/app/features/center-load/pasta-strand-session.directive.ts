/* SPDX-License-Identifier: GPL-3.0-or-later */
import { Directive, Input, OnChanges, OnDestroy } from '@angular/core';
import { StaticLoadPanelComponent } from './static-load-panel.component';
import { PastaStrandSessionService, PastaStrandSnapshot } from './pasta-strand-session.service';

/** Transfers the existing panel's counts when entering/leaving pasta mode.
 * Includes manual edits and optimizer output, without replacing the optimizer.
 */
@Directive({ selector: 'static-load-panel[pastaStrandSession]' })
export class PastaStrandSessionDirective implements OnChanges, OnDestroy {
  @Input() pastaStrandSession: 'truck' | 'center' | 'pasta' = 'center';
  private previous: string | undefined;
  private snapshot: PastaStrandSnapshot | undefined;
  constructor(private readonly panel: StaticLoadPanelComponent, private readonly session: PastaStrandSessionService) {}
  ngOnChanges(): void {
    if (this.previous === 'pasta') this.capture();
    if (this.pastaStrandSession === 'pasta') {
      this.panel.strandCounts = this.session.read(); this.snapshot = this.session.snapshot();
    }
    this.previous = this.pastaStrandSession;
  }
  ngOnDestroy(): void { if (this.previous === 'pasta') this.capture(); }
  private capture(): void {
    if (this.snapshot) this.session.publish(this.panel.strandCounts, this.snapshot);
  }
}
