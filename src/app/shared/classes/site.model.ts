/* Copyright (c) 2025-2026 Gene Ressler
   SPDX-License-Identifier: GPL-3.0-or-later */

import { DesignConditions, DesignConditionsService } from '../services/design-conditions.service';
import { Rectangle2D } from './graphics';
import { SiteConstants } from './site-constants';

/** Immutable container for site geometry and other info that depends only on design conditions. */
export class SiteModel {
  public readonly designConditions: DesignConditions = DesignConditionsService.PLACEHOLDER_CONDITIONS;
  public readonly spanExtent: Rectangle2D = Rectangle2D.createEmpty();
  public readonly drawingWindow: Rectangle2D = Rectangle2D.createEmpty();
  public readonly halfCutGapWidth: number;
  public readonly xLeftmostDeckJoint: number;
  public readonly xRightmostDeckJoint: number;
  public readonly yGradeLevel: number;
  public readonly leftAbutmentInterfaceTerrainIndex: number;
  public readonly rightAbutmentInterfaceTerrainIndex: number;

  constructor(conditions: DesignConditions) {
    this.xLeftmostDeckJoint = conditions.xLeftmostDeckJoint;
    this.xRightmostDeckJoint = conditions.xRightmostDeckJoint;
    this.yGradeLevel = SiteConstants.GAP_DEPTH - conditions.deckElevation + SiteConstants.DECK_TOP_HEIGHT;
    this.halfCutGapWidth = 0.5 * (this.xRightmostDeckJoint - this.xLeftmostDeckJoint);

    // Find indices in the terrain profile point array that are hidden by the abutments.  This gives us
    // a way to separate excavation area from remaining bank material.  Note: x coords of the elevation terrain
    // curve are descending (CCW order for the polygon).
    this.leftAbutmentInterfaceTerrainIndex = SiteConstants.ELEVATION_TERRAIN_POINTS.length - 1;
    const leftLimit = this.xLeftmostDeckJoint - SiteConstants.ABUTMENT_INTERFACE_SETBACK;
    while (
      SiteConstants.ELEVATION_TERRAIN_POINTS[this.leftAbutmentInterfaceTerrainIndex].x + this.halfCutGapWidth <
      leftLimit
    ) {
      this.leftAbutmentInterfaceTerrainIndex--;
    }
    this.rightAbutmentInterfaceTerrainIndex = 0;
    const rightLimit = this.xRightmostDeckJoint + SiteConstants.ABUTMENT_INTERFACE_SETBACK;
    while (
      SiteConstants.ELEVATION_TERRAIN_POINTS[this.rightAbutmentInterfaceTerrainIndex].x + this.halfCutGapWidth >
      rightLimit
    ) {
      this.rightAbutmentInterfaceTerrainIndex++;
    }

    // Canonical rectangular span extent.
    this.spanExtent.x0 = this.xLeftmostDeckJoint;
    this.spanExtent.y0 = -conditions.underClearance;
    this.spanExtent.width = conditions.spanLength;
    this.spanExtent.height = conditions.underClearance + conditions.overClearance;

    this.drawingWindow.x0 = this.spanExtent.x0 - SiteConstants.DRAWING_X_MARGIN;
    this.drawingWindow.width = this.spanExtent.width + 2 * SiteConstants.DRAWING_X_MARGIN;
    if (conditions.isLeftAnchorage) {
      this.drawingWindow.x0 -= SiteConstants.ANCHOR_OFFSET;
      this.drawingWindow.width += SiteConstants.ANCHOR_OFFSET;
    }
    if (conditions.isRightAnchorage) {
      this.drawingWindow.width += SiteConstants.ANCHOR_OFFSET;
    }
    // Extra 4 shows bottom of lowest abutment position.
    this.drawingWindow.y0 = this.yGradeLevel - SiteConstants.WATER_BELOW_GRADE - 4;
    this.drawingWindow.height = this.yGradeLevel + SiteConstants.OVERHEAD_CLEARANCE - this.drawingWindow.y0;
    if (conditions.isPasta) {
      // Pasta: the design space plus a small margin; no river valley. 3 world m = 7.5 cm.
      this.drawingWindow.y0 = this.spanExtent.y0 - SiteConstants.PASTA_MARGIN;
      this.drawingWindow.height = this.spanExtent.height + 2 * SiteConstants.PASTA_MARGIN;
    }
    this.designConditions = conditions;
  }

  public get leftBankX() {
    return this.halfCutGapWidth - SiteConstants.GAP_NATURAL_HALF_WIDTH;
  }

  public get rightBankX() {
    return this.halfCutGapWidth + SiteConstants.GAP_NATURAL_HALF_WIDTH;
  }
}

