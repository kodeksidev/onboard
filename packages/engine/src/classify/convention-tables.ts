/**
 * @onboard/engine — classification convention tables (Section 8.6).
 *
 * `FileClassificationValue` mirrors the frozen contract enum's TS type.
 * `CLASSIFICATION_RULE_ORDER` documents the exact 1-18 rule priority order
 * the spec defines (excluding rule 1, `entrypoint`, which is a precondition
 * checked before any table lookup) so tests can assert "first match wins,
 * evaluated top to bottom" against a single source of truth instead of
 * re-deriving it from `classify-file.ts`'s control flow.
 */
import { z } from 'zod';
import { FileClassification } from '@onboard/contract';

export type FileClassificationValue = z.infer<typeof FileClassification>;

export const CLASSIFICATION_RULE_ORDER: readonly FileClassificationValue[] = [
  'entrypoint',
  'test',
  'fixture',
  'style',
  'docs',
  'config',
  'generated',
  'route',
  'controller',
  'service',
  'model',
  'component',
  'hook',
  'store',
  'util',
  'script',
  'asset',
  'unknown',
];
