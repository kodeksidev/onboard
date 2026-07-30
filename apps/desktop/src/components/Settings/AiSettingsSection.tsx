import { useState } from 'react';
import type { ChangeEvent, JSX } from 'react';
import type { AiProvider, AiSettings } from '@/ipc/settings-schema';
import { Button } from '@/components/ui/button';
import { SETTINGS_COPY } from '@/copy/messages';
import { useSettingsStore } from '@/state/settingsStore';
import { TestKeyButton } from './TestKeyButton';

const PROVIDER_OPTIONS: readonly AiProvider[] = ['anthropic', 'ollama'];

const FIELD_CLASS =
  'rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900';

interface AiFieldsProps {
  readonly ai: AiSettings;
  readonly onChange: (patch: Partial<AiSettings>) => void;
}

function ProviderAndModelFields({ ai, onChange }: AiFieldsProps): JSX.Element {
  const handleProviderChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    onChange({ provider: event.target.value as AiProvider });
  };
  const handleModelChange = (event: ChangeEvent<HTMLInputElement>): void => {
    onChange({ model: event.target.value });
  };

  return (
    <>
      <label className="flex flex-col gap-1 text-sm">
        {SETTINGS_COPY.providerLabel}
        <select value={ai.provider} onChange={handleProviderChange} className={FIELD_CLASS}>
          {PROVIDER_OPTIONS.map((provider) => (
            <option key={provider} value={provider}>
              {SETTINGS_COPY.providerOptionLabels[provider]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {SETTINGS_COPY.modelLabel}
        <input
          type="text"
          value={ai.model}
          placeholder={SETTINGS_COPY.modelPlaceholder}
          onChange={handleModelChange}
          className={FIELD_CLASS}
        />
      </label>
    </>
  );
}

/** Ollama's own base url — each
 * shown only for its own provider. */
function BaseUrlField({ ai, onChange }: AiFieldsProps): JSX.Element | null {
  if (ai.provider === 'ollama') {
    return (
      <label className="flex flex-col gap-1 text-sm">
        {SETTINGS_COPY.ollamaBaseUrlLabel}
        <input
          type="text"
          value={ai.ollamaBaseUrl}
          onChange={(event) => onChange({ ollamaBaseUrl: event.target.value })}
          className={FIELD_CLASS}
        />
      </label>
    );
  }
  return null;
}

interface KeyActionsProps {
  readonly ai: AiSettings;
  readonly canSave: boolean;
  readonly onSave: () => void;
}

function KeyActions({ ai, canSave, onSave }: KeyActionsProps): JSX.Element {
  const clearAiKey = useSettingsStore((state) => state.clearAiKey);
  return (
    <div className="flex gap-2">
      <Button type="button" size="sm" onClick={onSave} disabled={!canSave}>
        {SETTINGS_COPY.saveKeyLabel}
      </Button>
      {ai.hasStoredKey ? (
        <Button type="button" size="sm" variant="ghost" onClick={() => void clearAiKey(ai.provider)}>
          {SETTINGS_COPY.clearKeyLabel}
        </Button>
      ) : null}
    </div>
  );
}

/** Hidden entirely for Ollama — it needs no credential
 * (`AiProvider::requires_stored_key` returns `false` for it on the Rust
 * side, `ai::permit`'s doc comment) — rather than shown-but-inert. */
function ApiKeySection({ ai }: { readonly ai: AiSettings }): JSX.Element | null {
  const storeAiKey = useSettingsStore((state) => state.storeAiKey);
  const [apiKeyInput, setApiKeyInput] = useState('');

  if (ai.provider === 'ollama') {
    return null;
  }

  const handleSaveKey = (): void => {
    if (apiKeyInput.trim() === '') {
      return;
    }
    void storeAiKey(ai.provider, apiKeyInput).then(() => setApiKeyInput(''));
  };

  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor="ai-api-key-input">{SETTINGS_COPY.apiKeyLabel}</label>
      <input
        id="ai-api-key-input"
        type="password"
        value={apiKeyInput}
        placeholder={SETTINGS_COPY.apiKeyPlaceholder}
        onChange={(event) => setApiKeyInput(event.target.value)}
        className={FIELD_CLASS}
      />
      {ai.hasStoredKey ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {SETTINGS_COPY.apiKeyAlreadyStoredHint}
        </p>
      ) : null}
      <KeyActions ai={ai} canSave={apiKeyInput.trim() !== ''} onSave={handleSaveKey} />
    </div>
  );
}

/**
 * Section 9 Phase 12 step 5 / Section 6.2: the "AI (optional)" settings
 * section — master toggle, provider dropdown (three), `base_url` (shown
 * for Ollama's own base url), a single API-key
 * paste field with Save/Clear, a model field, and `TestKeyButton`. A20/A5
 * still hold: the toggle defaults to off (`DEFAULT_SETTINGS`) and nothing
 * here changes that.
 *
 * Every field change calls `updateSettings` directly (Section 12: no
 * separate "unsaved draft" state on the webview side — settings persist as
 * they are edited, matching every other Settings-adjacent store action in
 * this app).
 */
export function AiSettingsSection(): JSX.Element {
  const ai = useSettingsStore((state) => state.settings.ai);
  const updateSettings = useSettingsStore((state) => state.updateSettings);

  const handleFieldChange = (patch: Partial<AiSettings>): void => {
    void updateSettings({ ai: { ...ai, ...patch } });
  };

  return (
    <section aria-labelledby="ai-settings-heading" className="flex flex-col gap-4">
      <div>
        <h3 id="ai-settings-heading" className="text-sm font-semibold">
          {SETTINGS_COPY.aiSectionTitle}
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {SETTINGS_COPY.aiSectionDescription}
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={ai.isEnabled}
          onChange={() => handleFieldChange({ isEnabled: !ai.isEnabled })}
        />
        {SETTINGS_COPY.enableToggleLabel}
      </label>

      <ProviderAndModelFields ai={ai} onChange={handleFieldChange} />
      <BaseUrlField ai={ai} onChange={handleFieldChange} />
      <ApiKeySection ai={ai} />
      <TestKeyButton provider={ai.provider} model={ai.model} />
    </section>
  );
}
