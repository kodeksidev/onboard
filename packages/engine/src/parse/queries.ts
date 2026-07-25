/**
 * @onboard/engine — loads the `.scm` tree-sitter query source for a language.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupportedLanguageId } from './language-parser';

const QUERY_FILE_NAMES: Readonly<Record<SupportedLanguageId, string>> = {
  javascript: 'javascript.scm',
  typescript: 'ts.scm',
  tsx: 'tsx.scm',
  python: 'python.scm',
};

const QUERIES_DIR = join(import.meta.dir, 'queries');

export function readQuerySource(languageId: SupportedLanguageId): string {
  return readFileSync(join(QUERIES_DIR, QUERY_FILE_NAMES[languageId]), 'utf8');
}
