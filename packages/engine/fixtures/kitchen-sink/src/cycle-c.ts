import { fromA } from './cycle-a';

export const fromC = 'cycle-c';

export function useFromC(): string {
  return fromA;
}
