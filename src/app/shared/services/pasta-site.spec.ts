/* Copyright (c) 2026 ElCreemi1
   SPDX-License-Identifier: GPL-3.0-or-later */

import { TestBed } from '@angular/core/testing';
import { ContestParametersService, SearchStringProvider } from './contest-parameters.service';
import { DesignConditions, DesignConditionsService, PASTA_CODE_LONG, PASTA_TAG } from './design-conditions.service';
import { SiteModel } from '../classes/site.model';
import { DEFAULT_MAX_STRAND_LENGTH_M, PastaSettingsService } from './pasta-settings.service';

describe('Pasta site', () => {
  let service: DesignConditionsService;
  let pasta: DesignConditions;

  beforeEach(() => {
    localStorage.removeItem('bridge-designer.pastaMaxStrandLengthM');
    TestBed.configureTestingModule({
      providers: [
        ContestParametersService,
        { provide: SearchStringProvider, useValue: { value: null } },
      ],
    });
    service = TestBed.inject(DesignConditionsService);
    pasta = service.pastaConditions;
  });

  it('is a valid design type with a 1.00 m span at 2.5 cm per world meter', () => {
    expect(pasta.isValid).toBeTrue();
    expect(pasta.isPasta).toBeTrue();
    expect(pasta.tag).toBe(PASTA_TAG);
    expect(pasta.spanLength * pasta.displayScale).toBeCloseTo(1, 12);
    expect(pasta.displayScale).toBeCloseTo(0.025, 12);
    expect(pasta.panelCount).toBe(10);
  });

  it('uses simple end supports with no arch, pier, or anchorage', () => {
    expect(pasta.isArch).toBeFalse();
    expect(pasta.isPier).toBeFalse();
    expect(pasta.isLeftAnchorage).toBeFalse();
    expect(pasta.isRightAnchorage).toBeFalse();
    expect(pasta.prescribedJoints.length).toBe(11);
  });

  it('turns off the steel slenderness limit', () => {
    expect(pasta.allowableSlenderness).toBe(Number.POSITIVE_INFINITY);
  });

  it('round-trips through its saved scenario code', () => {
    expect(service.getConditionsForCodeLong(PASTA_CODE_LONG)).toBe(pasta);
  });

  it('leaves steel sites and wizard setup keys unchanged', () => {
    const steel = service.getStandardConditionsForTag('02A')!;
    expect(steel.isPasta).toBeFalse();
    expect(steel.displayScale).toBe(1);
    expect(service.getConditionsForSetupKey(steel.setupKey)).toBe(steel);
    expect(service.getConditionsForCodeLong(steel.codeLong)).toBe(steel);
  });

  it('rejects load case 5 with any other geometry', () => {
    spyOn(console, 'error');
    const params = TestBed.inject(ContestParametersService).parameters;
    expect(DesignConditions.fromKeyCodeLong(5110824000, params).isValid).toBeFalse();
    expect(DesignConditions.fromKeyCodeLong(PASTA_CODE_LONG, params).isValid).toBeTrue();
  });

  it('draws only the design space plus a margin, not the river valley', () => {
    const site = new SiteModel(pasta);
    const window = site.drawingWindow;
    expect(window.y0).toBeLessThan(site.spanExtent.y0);
    expect(window.y0 + window.height).toBeGreaterThan(site.spanExtent.y0 + site.spanExtent.height);
    expect(window.height).toBeLessThan(new SiteModel(service.getStandardConditionsForTag('02A')!).drawingWindow.height);
  });
});

describe('PastaSettingsService', () => {
  beforeEach(() => localStorage.removeItem('bridge-designer.pastaMaxStrandLengthM'));

  it('defaults to a 25 cm strand and flags only longer members', () => {
    const settings = new PastaSettingsService();
    expect(settings.maxStrandLengthM).toBe(DEFAULT_MAX_STRAND_LENGTH_M);
    expect(settings.isOverLength(0.25)).toBeFalse();
    expect(settings.isOverLength(0.2501)).toBeTrue();
  });

  it('remembers a new limit, announces it, and ignores invalid values', () => {
    const settings = new PastaSettingsService();
    const seen: number[] = [];
    settings.maxStrandLengthChange.subscribe(v => seen.push(v));
    settings.maxStrandLengthM = 0.3;
    settings.maxStrandLengthM = -1;
    settings.maxStrandLengthM = NaN;
    expect(seen).toEqual([0.3]);
    expect(new PastaSettingsService().maxStrandLengthM).toBe(0.3);
    localStorage.removeItem('bridge-designer.pastaMaxStrandLengthM');
  });
});
