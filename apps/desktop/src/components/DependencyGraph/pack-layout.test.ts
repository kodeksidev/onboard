import { describe, expect, test } from 'vitest';
import cytoscape from 'cytoscape';
import { hasTopLevelEdges, packTopLevelIfUnforced, shelfPack, topLevelVisibleNodes } from './pack-layout';

describe('shelfPack', () => {
  test('never overlaps two boxes, whatever their sizes', () => {
    const items = [
      { id: 'a', width: 170, height: 170 },
      { id: 'b', width: 44, height: 44 },
      { id: 'c', width: 120, height: 120 },
      { id: 'd', width: 60, height: 60 },
    ];

    const packed = shelfPack(items, 16 / 9);

    // The defect this replaces was overlap: Cytoscape's `grid` is not
    // node-size aware, so the big directory boxes landed on top of each other.
    for (const first of items) {
      for (const second of items) {
        if (first.id >= second.id) {
          continue;
        }
        const a = packed.get(first.id);
        const b = packed.get(second.id);
        expect(a).toBeDefined();
        expect(b).toBeDefined();
        const overlapX = Math.abs(a!.x - b!.x) < (first.width + second.width) / 2;
        const overlapY = Math.abs(a!.y - b!.y) < (first.height + second.height) / 2;
        expect(overlapX && overlapY).toBe(false);
      }
    }
  });

  test('is deterministic — the same graph packs the same way every time', () => {
    const items = [
      { id: 'b', width: 50, height: 50 },
      { id: 'a', width: 50, height: 50 },
      { id: 'c', width: 50, height: 50 },
    ];

    const first = shelfPack(items, 16 / 9);
    const second = shelfPack([...items].reverse(), 16 / 9);

    expect([...first.entries()].sort()).toEqual([...second.entries()].sort());
  });

  test('wraps into rows rather than one endless line', () => {
    const items = Array.from({ length: 12 }, (_unused, index) => ({
      id: `n${String(index)}`,
      width: 100,
      height: 100,
    }));

    const packed = shelfPack(items, 16 / 9);

    expect(new Set([...packed.values()].map((position) => position.y)).size).toBeGreaterThan(1);
  });
});

describe('hasTopLevelEdges', () => {
  function build(elements: cytoscape.ElementDefinition[]): cytoscape.Core {
    return cytoscape({ headless: true, styleEnabled: true, elements });
  }

  test('an edge between two files INSIDE one directory is not a top-level edge', () => {
    const cy = build([
      { data: { id: 'dir:a' }, classes: 'directory-node' },
      { data: { id: 'file:a/one', parent: 'dir:a' }, classes: 'file-node' },
      { data: { id: 'file:a/two', parent: 'dir:a' }, classes: 'file-node' },
      { data: { id: 'e1', source: 'file:a/one', target: 'file:a/two' }, classes: 'import-edge' },
    ]);

    // This is exactly CacttusEdu's shape: every edge lives inside one
    // top-level directory, so nothing constrains where that directory sits.
    expect(hasTopLevelEdges(cy)).toBe(false);
    cy.destroy();
  });

  test('an edge that crosses two top-level directories is', () => {
    const cy = build([
      { data: { id: 'dir:a' }, classes: 'directory-node' },
      { data: { id: 'dir:b' }, classes: 'directory-node' },
      { data: { id: 'file:a/one', parent: 'dir:a' }, classes: 'file-node' },
      { data: { id: 'file:b/one', parent: 'dir:b' }, classes: 'file-node' },
      { data: { id: 'e1', source: 'file:a/one', target: 'file:b/one' }, classes: 'import-edge' },
    ]);

    expect(hasTopLevelEdges(cy)).toBe(true);
    cy.destroy();
  });
});

describe('packTopLevelIfUnforced', () => {
  /** A directory with two children, plus loose root files — the drilled-in shape. */
  function buildDrilledGraph(): cytoscape.Core {
    return cytoscape({
      headless: true,
      styleEnabled: true,
      elements: [
        { data: { id: 'dir:backend' }, classes: 'directory-node' },
        { data: { id: 'file:backend/a', parent: 'dir:backend' }, position: { x: 0, y: 0 }, classes: 'file-node' },
        { data: { id: 'file:backend/b', parent: 'dir:backend' }, position: { x: 80, y: 60 }, classes: 'file-node' },
        { data: { id: 'e1', source: 'file:backend/a', target: 'file:backend/b' }, classes: 'import-edge' },
        // Root files that the force layout parked inside the compound's box.
        { data: { id: 'file:README.md' }, position: { x: 20, y: 20 }, classes: 'file-node' },
        { data: { id: 'file:docker-compose.yml' }, position: { x: 40, y: 40 }, classes: 'file-node' },
      ],
    });
  }

  test('lifts root files out of a directory box they do not belong to', () => {
    const cy = buildDrilledGraph();
    const compound = cy.getElementById('dir:backend');
    const intruder = cy.getElementById('file:README.md');
    const isInside = (): boolean => {
      const box = compound.boundingBox();
      const point = intruder.position();
      return point.x >= box.x1 && point.x <= box.x2 && point.y >= box.y1 && point.y <= box.y2;
    };
    expect(isInside()).toBe(true); // the defect, reproduced

    expect(packTopLevelIfUnforced(cy)).toBe(true);

    // Containment on this canvas means "is a file in this directory". A node
    // resting inside a box it is not a child of draws a relationship that does
    // not exist, which is worse than an untidy layout.
    expect(isInside()).toBe(false);
    cy.destroy();
  });

  test('moves a directory box together with its contents, preserving the layout inside it', () => {
    const cy = buildDrilledGraph();
    const before = cy
      .getElementById('file:backend/b')
      .position();
    const anchor = cy.getElementById('file:backend/a').position();
    const relativeBefore = { x: before.x - anchor.x, y: before.y - anchor.y };

    packTopLevelIfUnforced(cy);

    const afterAnchor = cy.getElementById('file:backend/a').position();
    const after = cy.getElementById('file:backend/b').position();
    expect({ x: after.x - afterAnchor.x, y: after.y - afterAnchor.y }).toEqual(relativeBefore);
    cy.destroy();
  });

  test('leaves a graph alone when its top level really is connected', () => {
    const cy = cytoscape({
      headless: true,
      styleEnabled: true,
      elements: [
        { data: { id: 'file:a' }, classes: 'file-node' },
        { data: { id: 'file:b' }, classes: 'file-node' },
        { data: { id: 'e1', source: 'file:a', target: 'file:b' }, classes: 'import-edge' },
      ],
    });
    cy.getElementById('file:a').position({ x: 0, y: 0 });
    cy.getElementById('file:b').position({ x: 300, y: 20 });

    // Those positions carry the force layout's meaning; packing would discard it.
    expect(packTopLevelIfUnforced(cy)).toBe(false);
    expect(cy.getElementById('file:b').position()).toEqual({ x: 300, y: 20 });
    cy.destroy();
  });

  test('ignores nodes hidden by collapse when deciding what is top level', () => {
    const cy = cytoscape({
      headless: true,
      styleEnabled: true,
      style: [{ selector: '.hidden-by-collapse', style: { display: 'none' } }],
      elements: [
        { data: { id: 'dir:a' }, classes: 'directory-node' },
        { data: { id: 'file:a/hidden', parent: 'dir:a' }, classes: 'file-node hidden-by-collapse' },
        { data: { id: 'file:root' }, classes: 'file-node' },
      ],
    });

    expect(topLevelVisibleNodes(cy).map((node) => node.id()).sort()).toEqual(['dir:a', 'file:root']);
    cy.destroy();
  });
});
