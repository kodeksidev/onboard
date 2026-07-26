import { fromC } from './cycle-c';

export const fromB = 'cycle-b';

export function useFromB(): string {
  return fromC;
}
