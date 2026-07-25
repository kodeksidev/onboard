import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * The standard shadcn/ui class-merging helper: `clsx` composes conditional
 * class strings, `twMerge` resolves Tailwind utility conflicts (e.g. a
 * caller-supplied `p-2` overriding a default `p-4`) so callers can safely
 * override component styling from the outside.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
