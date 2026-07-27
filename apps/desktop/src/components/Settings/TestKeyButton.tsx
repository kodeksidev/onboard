import { useState } from 'react';
import type { JSX } from 'react';
import type { AiProviderName } from '@/ipc/ipc';
import { parseIpcError } from '@/ipc/ipc';
import { Button } from '@/components/ui/button';
import { SETTINGS_COPY, resolveErrorCopy } from '@/copy/messages';
import { useSettingsStore } from '@/state/settingsStore';

export interface TestKeyButtonProps {
  readonly provider: AiProviderName;
  readonly model: string;
}

type TestState =
  | { readonly status: 'idle' }
  | { readonly status: 'pending' }
  | { readonly status: 'success'; readonly latencyMs: number }
  | { readonly status: 'failure'; readonly title: string; readonly description: string };

/**
 * "Test key" (Section 7.4's `test_ai_key`) makes one real round trip
 * through the full chokepoint on the Rust side
 * (`apps/desktop/src-tauri/src/commands/ai.rs`'s doc comment: permit →
 * redaction → `ResolvedEndpoint` → `http::send`) — this component's only
 * job is presenting that round trip's real outcome. For Ollama the same
 * button is naturally a reachability test rather than a credential test
 * (Ollama needs no key — `ai::permit`'s doc comment) — reflected here only
 * as a label difference, not a different code path: both cases call the
 * exact same `testAiKey` store action.
 *
 * Failure copy is never a generic "test failed" — `resolveErrorCopy`
 * distinguishes E_AI_KEY_INVALID / E_AI_NETWORK / E_AI_OLLAMA_UNREACHABLE /
 * E_AI_MODEL_NOT_FOUND / E_AI_RATE_LIMITED by their own Section 10 copy,
 * so an invalid key and an unreachable Ollama instance never look the
 * same to the user.
 */
export function TestKeyButton({ provider, model }: TestKeyButtonProps): JSX.Element {
  const testAiKey = useSettingsStore((state) => state.testAiKey);
  const [state, setState] = useState<TestState>({ status: 'idle' });

  const handleClick = (): void => {
    setState({ status: 'pending' });
    testAiKey(provider, model)
      .then((result) => {
        setState({ status: 'success', latencyMs: result.latencyMs });
      })
      .catch((error: unknown) => {
        const copy = resolveErrorCopy(parseIpcError(error));
        setState({ status: 'failure', title: copy.title, description: copy.description });
      });
  };

  const buttonLabel =
    provider === 'ollama'
      ? SETTINGS_COPY.testConnectionButtonLabel
      : SETTINGS_COPY.testKeyButtonLabel;

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={handleClick}
        disabled={state.status === 'pending'}
      >
        {state.status === 'pending' ? SETTINGS_COPY.testingLabel : buttonLabel}
      </Button>
      {state.status === 'success' ? (
        <p role="status" className="text-sm text-emerald-600 dark:text-emerald-400">
          {SETTINGS_COPY.testSucceeded(state.latencyMs)}
        </p>
      ) : null}
      {state.status === 'failure' ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          <span className="font-medium">{state.title}</span> — {state.description}
        </p>
      ) : null}
    </div>
  );
}
