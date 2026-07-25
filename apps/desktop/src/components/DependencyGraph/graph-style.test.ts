import { describe, expect, test } from 'vitest';
import { buildGraphStylesheet } from './graph-style';

describe('buildGraphStylesheet', () => {
  const stylesheet = buildGraphStylesheet();
  const selectors = stylesheet.map((block) => ('selector' in block ? block.selector : null));

  test('sizes and colors file nodes from precomputed data fields, not a style function', () => {
    const fileRule = stylesheet.find((block) => 'selector' in block && block.selector === 'node.file-node');
    expect(fileRule).toBeDefined();
    const style = fileRule && 'style' in fileRule ? fileRule.style : undefined;
    expect(style).toMatchObject({ width: 'data(size)', height: 'data(size)', 'background-color': 'data(color)' });
  });

  test('includes a rule that hides labels via the .labels-hidden class (zoom < 0.35)', () => {
    expect(selectors).toContain('.labels-hidden');
  });

  test('distinguishes selection/dependency/dependent/keyboard-focus/dimmed states', () => {
    expect(selectors).toEqual(
      expect.arrayContaining([
        'node.selected-node',
        'node.highlighted-dependency',
        'node.highlighted-dependent',
        'node.keyboard-focused',
        '.dimmed',
      ]),
    );
  });

  test('styles compound directory nodes distinctly from file nodes', () => {
    expect(selectors).toContain('node.directory-node');
  });
});
