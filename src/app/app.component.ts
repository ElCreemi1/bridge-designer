/* Copyright (c) 2025-2026 Gene Ressler
   SPDX-License-Identifier: GPL-3.0-or-later */

import { AfterViewInit, Component, ElementRef, HostListener, ViewChild, ViewEncapsulation } from '@angular/core';
import { enterLandscapeFullscreen, exitLandscapeFullscreen } from './shared/touch/touch-web-support';
import { AboutDialogComponent } from './features/about/about-dialog/about-dialog.component';
import { CostReportDialogComponent } from './features/costs/cost-report-dialog/cost-report-dialog.component';
import { DesignIterationDialogComponent } from './features/iterations/design-iteration-dialog/design-iteration-dialog.component';
import { DesignSaverLoaderComponent } from './features/save-load/design-saver-loader/design-saver-loader.component';
import { DraftingPanelComponent } from './features/drafting/drafting-panel/drafting-panel.component';
import { EventBrokerService, EventOrigin } from './shared/services/event-broker.service';
import { FlyThruPaneComponent } from './features/fly-thru/pane/fly-thru-pane.component';
import { HelpDialogComponent } from './features/help/help-dialog/help-dialog.component';
import { LoadTestReportDialogComponent } from './features/testing/load-test-report-dialog/load-test-report-dialog.component';
import { MemberDetailsDialogComponent } from './features/member-details/member-details-dialog/member-details-dialog.component';
import { MemberEditDialogComponent } from './features/drafting/member-edit-dialog/member-edit-dialog.component';
import { MemberTableComponent } from './features/drafting/member-table/member-table.component';
import { MenusComponent } from './features/controls/menus/menus.component';
import { RulerComponent } from './features/drafting/ruler/ruler.component';
import { SampleSelectionDialogComponent } from './features/sample-bridge/sample-selection-dialog/sample-selection-dialog.component';
import { SessionStateService } from './features/session-state/session-state.service';
import { SetupWizardComponent } from './features/setup/setup-wizard/setup-wizard.component';
import { SlendernessFailDialogComponent } from './features/testing/slenderness-fail-dialog/slenderness-fail-dialog.component';
import { TemplateSelectionDialogComponent } from './features/template/template-selection-dialog/template-selection-dialog.component';
import { TipDialogComponent, TipDialogKind } from './features/tips/tip-dialog/tip-dialog.component';
import { ToolbarAComponent } from './features/controls/toolbar-a/toolbar-a.component';
import { ToolbarBComponent } from './features/controls/toolbar-b/toolbar-b.component';
import { UnstableBridgeDialogComponent } from './features/testing/unstable-bridge-dialog/unstable-bridge-dialog.component';
import { WelcomeDialogComponent } from './features/welcome/welcome-dialog/welcome-dialog.component';
import { WorkflowManagementService } from './features/controls/management/workflow-management.service';
import { DrawingsService } from './features/drawings/drawings.service';
import { Printing3dService } from './features/printing-3d/printing-3d.service';
import { Print3dDialogComponent } from './features/printing-3d/print-3d-dialog/print-3d-dialog.component';
import { MissingFeatureDisablerDialogComponent } from './features/browser/missing-feature-disabler-dialog/missing-feature-disabler-dialog.component';
import { AllowFreshStartDialogComponent } from './features/session-state/allow-fresh-start-dialog/allow-fresh-start-dialog.component';
import { BridgeService } from './shared/services/bridge.service';
import { DesignConditionsService } from './shared/services/design-conditions.service';
import { ContestWelcomeDialogComponent } from './features/contest/contest-welcome-dialog/contest-welcome-dialog.component';

// ¯\_(ツ)_/¯

@Component({
  selector: 'app-root',
  imports: [
    AboutDialogComponent,
    ContestWelcomeDialogComponent,
    CostReportDialogComponent,
    DesignIterationDialogComponent,
    DesignSaverLoaderComponent,
    DraftingPanelComponent,
    FlyThruPaneComponent,
    HelpDialogComponent,
    LoadTestReportDialogComponent,
    MemberDetailsDialogComponent,
    MemberEditDialogComponent,
    MemberTableComponent,
    MenusComponent,
    MissingFeatureDisablerDialogComponent,
    Print3dDialogComponent,
    RulerComponent,
    SampleSelectionDialogComponent,
    SetupWizardComponent,
    SlendernessFailDialogComponent,
    TemplateSelectionDialogComponent,
    TipDialogComponent,
    ToolbarAComponent,
    ToolbarBComponent,
    UnstableBridgeDialogComponent,
    WelcomeDialogComponent,
    AllowFreshStartDialogComponent,
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  encapsulation: ViewEncapsulation.None,
})
export class AppComponent implements AfterViewInit {
  private static readonly FOCUS_MODE_KEY = 'bridge-designer.focusMode';
  /** Hides menus, toolbars and the member table so only the drawing or simulation area remains. */
  focusMode = AppComponent.readFocusMode();

  private static storage(): Storage | undefined {
    try { return window.localStorage; } catch { return undefined; }
  }
  private static readFocusMode(): boolean {
    return AppComponent.storage()?.getItem(AppComponent.FOCUS_MODE_KEY) === '1';
  }
  toggleFocusMode(): void {
    this.focusMode = !this.focusMode;
    // On touch devices, Focus also goes full screen and locks landscape where the browser allows it.
    if (document.documentElement.classList.contains('touch-port')) {
      if (this.focusMode) void enterLandscapeFullscreen(); else exitLandscapeFullscreen();
    }
    try { AppComponent.storage()?.setItem(AppComponent.FOCUS_MODE_KEY, this.focusMode ? '1' : '0'); } catch { /* Optional. */ }
  }
  @ViewChild('allowFreshStartDialog') allowFreshStartDialog!: AllowFreshStartDialogComponent;
  @ViewChild('bottomRuler') bottomRuler!: RulerComponent;
  @ViewChild('contestWelcomeDialog') contestWelcomeDialog!: ContestWelcomeDialogComponent;
  @ViewChild('focusToggle') focusToggle?: ElementRef<HTMLButtonElement>;
  @ViewChild('draftingAreaCover') draftingAreaCover!: ElementRef<HTMLDivElement>;
  @ViewChild('leftRuler') leftRuler!: RulerComponent;
  @ViewChild('memberTable') memberTable!: MemberTableComponent;
  @ViewChild('missingFeatureDisablerDialog') missingFeatureDisablerDialog!: MissingFeatureDisablerDialogComponent;

  private requestedHelpTopic: string | null = null;

  constructor(
    private readonly bridgeService: BridgeService,
    private readonly eventBrokerService: EventBrokerService,
    private readonly sessionStateService: SessionStateService,
    _drawingsService: DrawingsService, // Instantiate only.
    _printing3dService: Printing3dService, // Instantiate only.
    _workflowManagementService: WorkflowManagementService, // Instantiate only.
  ) {}

  /** Shows the drafting panel or hides it under a gray facade. */
  private showDraftingPanelCover(value: boolean): void {
    this.draftingAreaCover.nativeElement.style.display = value ? 'block' : 'none';
  }

  @HostListener('document:visibilitychange')
  handleVisibilityChange(): void {
    // Don't save state until the user has begun work on a bridge.
    if (document.hidden && this.bridgeService.designConditions !== DesignConditionsService.PLACEHOLDER_CONDITIONS) {
      this.sessionStateService.saveState();
    }
  }

  ngAfterViewInit(): void {
    // Toggle rulers visibility.
    this.eventBrokerService.rulersToggle.subscribe(info => {
      this.leftRuler.visible = this.bottomRuler.visible = info.data;
    });
    this.eventBrokerService.memberTableToggle.subscribe(info => {
      this.memberTable.visible = info.data;
    });
    this.eventBrokerService.uiModeRequest.subscribe(info => {
      this.showDraftingPanelCover(info.data === 'initial');
      // Keep the Focus button clear of the 3D view's bottom-row controls.
      this.focusToggle?.nativeElement.classList.toggle('in-simulation', info.data === 'animation');
    });
    // Let everyone know if session management is enabled. E.g. the menu checked status.
    this.sessionStateService.restoreSessionManagementEnabled();
    // Manage the welcome sequence if there is one. Separate paths for cases where we've rehydrated and not.
    if (this.sessionStateService.hasRestoredState) {
      // Let everyone know the app is fully rehydrated. Not a great place for this, but simplest.
      this.sessionStateService.notifyRestoreComplete();
      // Quietly disable stuff for missing browser features. The user has seen disableAndInformUser() dialog, so understands.
      this.missingFeatureDisablerDialog.disableFeatures();
      // If the user closed the tab between de- and rehydration, offer to continue or start fresh.
      if (!this.sessionStateService.isCurrentStateDueToTabRefresh) {
        // The dialog resets the app via redirect to ?reset or chains to a tip.
        this.allowFreshStartDialog.open();
      }
    } else {
      this.eventBrokerService.uiModeRequest.next({ origin: EventOrigin.APP, data: 'initial' });
      // The dialog chains to a tip request.
      this.missingFeatureDisablerDialog.disableAndInformUser();
    }
    // Show a contest welcome splash if parameters are set. This hides other startup dialogs temporarily.
    this.contestWelcomeDialog.splashIfContest();
    this.handleUrlParameters();
  }

  /** Shows optional help topic recorded during startup now that the dialog has loaded. */
  handleHelpDialogLoad() {
    if (this.requestedHelpTopic !== null) {
      const data = { topic: this.requestedHelpTopic || 'hlp_how_to' };
      this.eventBrokerService.helpRequest.next({ origin: EventOrigin.APP, data });
    }
  }

  /** Takes the welcome step of the startup tip+welcome sequence. */
  handleTipDialogClose(kind: TipDialogKind) {
    if (kind === 'startup') {
      this.eventBrokerService.welcomeRequest.next({ origin: EventOrigin.APP, data: undefined });
    }
  }

  /** Handles initial URL parameters then deletes them. */
  private handleUrlParameters(): void {
    const url = new URL(window.location.href);
    const params = new URLSearchParams(window.location.search);

    // Allow user to reset local storage with URL query string "?reset".
    const reset = 'reset';
    if (params.get(reset) !== null) {
      // Here for completeness. Normally already done. See SessionStateService.
      localStorage.clear();
      params.delete(reset);
    }

    // Maybe record a help topic to show after deferred load of dialog.
    const help = 'help';
    this.requestedHelpTopic = params.get(help);
    if (this.requestedHelpTopic !== null) {
      params.delete(help);
    }

    // Update the browser's displayed URL without reloading.
    const resetUrl = `${url.origin}${url.pathname}?${params.toString()}`;
    window.history.pushState({}, '', resetUrl);
  }
}
