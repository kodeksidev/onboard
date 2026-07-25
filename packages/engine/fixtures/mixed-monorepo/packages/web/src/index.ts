import { coreValue } from '@acme/core';

export function render(): string {
  return `value: ${coreValue()}`;
}
