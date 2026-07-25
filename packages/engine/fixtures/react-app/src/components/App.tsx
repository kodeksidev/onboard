import { useToggle } from '@/hooks/useToggle';
import { Button } from './Button';

export function App(): string {
  useToggle();
  return Button();
}
