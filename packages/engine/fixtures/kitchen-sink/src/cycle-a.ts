import { fromB } from './cycle-b';

export const fromA = 'cycle-a';

export function useFromA(): string {
  return fromB;
}
