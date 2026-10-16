import { describe, it, expect } from "vitest";

import {
  parseSetupPayoffTags,
  buildSetupPayoffLedger,
  summarizeSetupPayoffAdvisory,
  computeSetupPayoffAdvisory,
  type SetupPayoffSourceEntry,
} from "./setupPayoffLedger";
import { createUnit, setUnitContent, setUnitStatus, type StructuralUnit } from "./stateLedger";

/**
 * Coverage for issue #173's Setup & Payoff Ledger module - tag
 * parsing, name-keyed pairing across units, dangling/orphaned
 * classification, and the development-time advisory wrapper.
 */

describe("parseSetupPayoffTags", () => {
  it("extracts both a setup and a payoff tag from the same content, trimmed", () => {
    const content = "SCENE 1: INT. HOUSE - DAY\n[SETUP: the music box]  She winds it once. [PAYOFF: an old debt] He finally pays her back.";
    const result = parseSetupPayoffTags(content);
    expect(result.setupNames).toEqual(["the music box"]);
    expect(result.payoffNames).toEqual(["an old debt"]);
  });

  it("returns two empty arrays when neither tag is present", () => {
    const result = parseSetupPayoffTags("SCENE 2: INT. ROOM - DAY\nNothing special happens here at all.");
    expect(result.setupNames).toEqual([]);
    expect(result.payoffNames).toEqual([]);
  });

  it("extracts multiple distinctly-named setup tags from one unit", () => {
    const content = "[SETUP: the gun] [SETUP: the locked door] A scene plants two things at once.";
    const result = parseSetupPayoffTags(content);
    expect(result.setupNames).toEqual(["the gun", "the locked door"]);
  });

  it("de-duplicates two tags of the same name differing only in casing, keeping the first casing seen", () => {
    const content = "[SETUP: The Gun] later in the same scene [SETUP: the gun] is mentioned again.";
    const result = parseSetupPayoffTags(content);
    expect(result.setupNames).toEqual(["The Gun"]);
  });
});

describe("buildSetupPayoffLedger", () => {
  function entry(unitId: string, content: string, sceneNumber: number, slugline: string): SetupPayoffSourceEntry {
    return { unitId, content, sceneNumber, slugline };
  }

  it("pairs a setup planted in one entry with its payoff in a later entry, case-insensitively", () => {
    const entries = [
      entry("u1", "[SETUP: the music box] She winds it once, uneasy.", 1, "SCENE 1: INT. HOUSE - DAY"),
      entry("u2", "A quiet scene with nothing tagged.", 2, "SCENE 2: EXT. STREET - DAY"),
      entry("u3", "[PAYOFF: THE MUSIC BOX] The box finally plays its song.", 3, "SCENE 3: INT. ATTIC - NIGHT"),
    ];

    const ledger = buildSetupPayoffLedger(entries);

    expect(ledger).toHaveLength(1);
    expect(ledger[0].name).toBe("the music box");
    expect(ledger[0].planted).toEqual({ unitId: "u1", sceneNumber: 1, slugline: "SCENE 1: INT. HOUSE - DAY" });
    expect(ledger[0].paidOff).toEqual({ unitId: "u3", sceneNumber: 3, slugline: "SCENE 3: INT. ATTIC - NIGHT" });
  });

  it("leaves paidOff null for a setup with no matching payoff anywhere (dangling)", () => {
    const entries = [entry("u1", "[SETUP: a locked door]", 1, "SCENE 1: INT. HOUSE - DAY")];
    const ledger = buildSetupPayoffLedger(entries);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].planted).not.toBeNull();
    expect(ledger[0].paidOff).toBeNull();
  });

  it("leaves planted null for a payoff with no matching setup anywhere (orphaned)", () => {
    const entries = [entry("u1", "[PAYOFF: a stray thread]", 1, "SCENE 1: INT. HOUSE - DAY")];
    const ledger = buildSetupPayoffLedger(entries);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].planted).toBeNull();
    expect(ledger[0].paidOff).not.toBeNull();
  });

  it("keeps the FIRST occurrence for a name re-planted more than once (disclosed simplification)", () => {
    const entries = [
      entry("u1", "[SETUP: the ring]", 1, "SCENE 1: INT. HOUSE - DAY"),
      entry("u2", "[SETUP: the ring]", 2, "SCENE 2: EXT. STREET - DAY"),
    ];
    const ledger = buildSetupPayoffLedger(entries);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].planted?.unitId).toBe("u1");
  });

  it("returns entries in order of each name's first appearance", () => {
    const entries = [
      entry("u1", "[PAYOFF: second thing]", 1, "SCENE 1"),
      entry("u2", "[SETUP: first thing]", 2, "SCENE 2"),
      entry("u3", "[SETUP: second thing]", 3, "SCENE 3"),
    ];
    const ledger = buildSetupPayoffLedger(entries);
    expect(ledger.map((e) => e.name)).toEqual(["second thing", "first thing"]);
  });
});

describe("summarizeSetupPayoffAdvisory", () => {
  it("classifies exactly the dangling and orphaned entries by name, excluding fully-resolved ones", () => {
    const entries: SetupPayoffSourceEntry[] = [
      { unitId: "u1", content: "[SETUP: dangling one]", sceneNumber: 1, slugline: "S1" },
      { unitId: "u2", content: "[PAYOFF: orphaned one]", sceneNumber: 2, slugline: "S2" },
      { unitId: "u3", content: "[SETUP: resolved one]", sceneNumber: 3, slugline: "S3" },
      { unitId: "u4", content: "[PAYOFF: resolved one]", sceneNumber: 4, slugline: "S4" },
    ];
    const ledger = buildSetupPayoffLedger(entries);
    const advisory = summarizeSetupPayoffAdvisory(ledger);

    expect(advisory.danglingSetups).toEqual(["dangling one"]);
    expect(advisory.orphanedPayoffs).toEqual(["orphaned one"]);
  });
});

function confirmedUnit(unitId: string, content: string): StructuralUnit {
  return setUnitStatus(setUnitContent(createUnit(unitId, "Scene"), content), "Confirmed");
}
function workingUnit(unitId: string, content: string): StructuralUnit {
  return setUnitStatus(setUnitContent(createUnit(unitId, "Scene"), content), "Working");
}
function exploringUnit(unitId: string, content: string): StructuralUnit {
  return setUnitContent(createUnit(unitId, "Scene"), content);
}

describe("computeSetupPayoffAdvisory", () => {
  it("includes Working and Confirmed units' tags, excluding Exploring units' tags (matches sceneDensity's counted set)", () => {
    const units: StructuralUnit[] = [
      workingUnit("working-1", "[SETUP: from a working unit]"),
      confirmedUnit("confirmed-1", "[SETUP: from a confirmed unit]"),
      exploringUnit("exploring-1", "[SETUP: from an exploring unit]"),
    ];

    const advisory = computeSetupPayoffAdvisory(units);

    expect(advisory.danglingSetups).toEqual(
      expect.arrayContaining(["from a working unit", "from a confirmed unit"])
    );
    expect(advisory.danglingSetups).not.toContain("from an exploring unit");
    expect(advisory.danglingSetups).toHaveLength(2);
  });

  it("returns empty advisory lists when no units carry any setup/payoff tags", () => {
    const units: StructuralUnit[] = [confirmedUnit("u1", "SCENE 1: INT. HOUSE - DAY\nNothing tagged here at all.")];
    const advisory = computeSetupPayoffAdvisory(units);
    expect(advisory.danglingSetups).toEqual([]);
    expect(advisory.orphanedPayoffs).toEqual([]);
  });
});
