export function useToggle(): [boolean, () => void] {
  let state = false;
  const toggle = (): void => {
    state = !state;
  };
  return [state, toggle];
}
