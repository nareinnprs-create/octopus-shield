import { Loader2, Play } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type {
  NeuroAuthScheme,
  NeuroConnectionTestResult,
  NeuroProviderKind,
  NeuroProviderProfile
} from '../../../../shared/neuro-provider-types'
import { cn } from '@/lib/utils'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Textarea } from '../ui/textarea'
import { SearchableSetting } from './SearchableSetting'

const AUTH_SCHEMES: readonly NeuroAuthScheme[] = ['none', 'bearer', 'header', 'query', 'basic']
const KINDS: readonly NeuroProviderKind[] = ['cloud', 'serverless', 'local']

export type NeuroProviderEditorProps = {
  draft: NeuroProviderProfile
  modelsText: string
  keyDraft: string
  busy: boolean
  testResult: NeuroConnectionTestResult | null
  keyStored: boolean
  keyPlaintext: boolean
  /** True when editing a persisted profile; the id names its key envelope. */
  idLocked: boolean
  onDraftChange: (draft: NeuroProviderProfile) => void
  onModelsTextChange: (text: string) => void
  onKeyDraftChange: (key: string) => void
  onSave: () => void
  onSaveKey: () => void
  onForgetKey: () => void
  onTest: () => void
  onCancel: () => void
}

export function NeuroProviderEditor({
  draft,
  modelsText,
  keyDraft,
  busy,
  testResult,
  keyStored,
  keyPlaintext,
  idLocked,
  onDraftChange,
  onModelsTextChange,
  onKeyDraftChange,
  onSave,
  onSaveKey,
  onForgetKey,
  onTest,
  onCancel
}: NeuroProviderEditorProps): React.JSX.Element {
  return (
    <SearchableSetting
      title={translate(
        'auto.components.settings.NeuroProvidersPane.editorTitle',
        'Provider editor'
      )}
      description={translate(
        'auto.components.settings.NeuroProvidersPane.editorDescription',
        'Saving with an existing ID overwrites that provider.'
      )}
      forceVisible
      className="space-y-4 rounded-lg border border-border/60 p-4"
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="neuro-id">ID</Label>
          <Input
            id="neuro-id"
            value={draft.id}
            disabled={idLocked}
            onChange={(event) =>
              onDraftChange({ ...draft, id: event.target.value.trim().toLowerCase() })
            }
            placeholder="my-endpoint"
            spellCheck={false}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="neuro-name">
            {translate('auto.components.settings.NeuroProvidersPane.name', 'Name')}
          </Label>
          <Input
            id="neuro-name"
            value={draft.name}
            onChange={(event) => onDraftChange({ ...draft, name: event.target.value })}
            spellCheck={false}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="neuro-kind">
            {translate('auto.components.settings.NeuroProvidersPane.kind', 'Kind')}
          </Label>
          <Select
            value={draft.kind}
            onValueChange={(value) => onDraftChange({ ...draft, kind: value as NeuroProviderKind })}
          >
            <SelectTrigger id="neuro-kind" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KINDS.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {kind}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="neuro-base-url">
            {translate('auto.components.settings.NeuroProvidersPane.baseUrl', 'Base URL')}
          </Label>
          <Input
            id="neuro-base-url"
            value={draft.baseUrl}
            onChange={(event) => onDraftChange({ ...draft, baseUrl: event.target.value.trim() })}
            placeholder="http://localhost:11434"
            spellCheck={false}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="neuro-chat-path">
            {translate('auto.components.settings.NeuroProvidersPane.chatPath', 'Chat path')}
          </Label>
          <Input
            id="neuro-chat-path"
            value={draft.chatPath}
            onChange={(event) => onDraftChange({ ...draft, chatPath: event.target.value })}
            spellCheck={false}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="neuro-auth-scheme">
            {translate('auto.components.settings.NeuroProvidersPane.authScheme', 'Auth')}
          </Label>
          <Select
            value={draft.authScheme}
            onValueChange={(value) =>
              onDraftChange({
                ...draft,
                authScheme: value as NeuroAuthScheme,
                authLocation: value === 'header' || value === 'query' ? draft.authLocation : null
              })
            }
          >
            <SelectTrigger id="neuro-auth-scheme" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AUTH_SCHEMES.map((scheme) => (
                <SelectItem key={scheme} value={scheme}>
                  {scheme}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {draft.authScheme === 'header' || draft.authScheme === 'query' ? (
          <div className="space-y-1.5">
            <Label htmlFor="neuro-auth-location">
              {draft.authScheme === 'header'
                ? translate('auto.components.settings.NeuroProvidersPane.headerName', 'Header name')
                : translate(
                    'auto.components.settings.NeuroProvidersPane.queryParam',
                    'Query param'
                  )}
            </Label>
            <Input
              id="neuro-auth-location"
              value={draft.authLocation ?? ''}
              onChange={(event) =>
                onDraftChange({ ...draft, authLocation: event.target.value.trim() })
              }
              spellCheck={false}
            />
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="neuro-response-path">
            {translate('auto.components.settings.NeuroProvidersPane.responsePath', 'Response path')}
          </Label>
          <Input
            id="neuro-response-path"
            value={draft.responsePath ?? ''}
            onChange={(event) =>
              onDraftChange({ ...draft, responsePath: event.target.value.trim() })
            }
            placeholder="choices.0.message.content"
            spellCheck={false}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="neuro-models">
          {translate('auto.components.settings.NeuroProvidersPane.models', 'Models')}
        </Label>
        <Textarea
          id="neuro-models"
          value={modelsText}
          onChange={(event) => onModelsTextChange(event.target.value)}
          placeholder={'gpt-4o\nllama3.2'}
          className="min-h-16 font-mono text-xs"
          spellCheck={false}
        />
      </div>

      {draft.kind === 'serverless' ? (
        <div className="space-y-1.5">
          <Label htmlFor="neuro-template">
            {translate(
              'auto.components.settings.NeuroProvidersPane.template',
              'Request template (JSON, {{model}} and {{prompt}} placeholders)'
            )}
          </Label>
          <Textarea
            id="neuro-template"
            value={draft.requestTemplate ?? ''}
            onChange={(event) =>
              onDraftChange({ ...draft, requestTemplate: event.target.value.trim() || null })
            }
            placeholder='{"model":"{{model}}","input":"{{prompt}}"}'
            className="min-h-16 font-mono text-xs"
            spellCheck={false}
          />
        </div>
      ) : null}

      {draft.authScheme !== 'none' ? (
        <div className="space-y-1.5">
          <Label htmlFor="neuro-key">
            {translate('auto.components.settings.NeuroProvidersPane.key', 'API key')}
          </Label>
          <div className="flex gap-2">
            <Input
              id="neuro-key"
              type="password"
              value={keyDraft}
              onChange={(event) => onKeyDraftChange(event.target.value)}
              placeholder={
                keyStored
                  ? translate(
                      'auto.components.settings.NeuroProvidersPane.keyStoredPlaceholder',
                      'Saved — paste to replace'
                    )
                  : translate(
                      'auto.components.settings.NeuroProvidersPane.keyPlaceholder',
                      'Paste API key'
                    )
              }
              className="flex-1"
              spellCheck={false}
            />
            <Button
              size="xs"
              disabled={busy || !keyDraft.trim()}
              onClick={onSaveKey}
              className="shrink-0"
            >
              {translate('auto.components.settings.NeuroProvidersPane.saveKey', 'Save key')}
            </Button>
            {keyStored ? (
              <Button
                variant="ghost"
                size="xs"
                disabled={busy}
                onClick={onForgetKey}
                className="shrink-0"
              >
                {translate('auto.components.settings.NeuroProvidersPane.forgetKey', 'Forget key')}
              </Button>
            ) : null}
          </div>
          {keyPlaintext ? (
            <p className="text-xs text-status-warning">
              {translate(
                'auto.components.settings.NeuroProvidersPane.plaintextWarning',
                'Stored without OS keyring encryption — resave once a keyring is available.'
              )}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="outline" size="xs" disabled={busy} onClick={onTest}>
            {busy ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
            {translate('auto.components.settings.NeuroProvidersPane.test', 'Test connection')}
          </Button>
          {testResult ? (
            <p
              className={cn(
                'min-w-0 truncate text-xs',
                testResult.ok ? 'text-muted-foreground' : 'text-destructive'
              )}
            >
              {testResult.ok ? '✓ ' : '✗ '}
              {testResult.detail}
              {testResult.latencyMs !== null ? ` (${testResult.latencyMs}ms)` : ''}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="ghost" size="xs" onClick={onCancel}>
            {translate('auto.components.settings.NeuroProvidersPane.cancel', 'Cancel')}
          </Button>
          <Button size="xs" disabled={busy || !draft.id || !draft.baseUrl} onClick={onSave}>
            {translate('auto.components.settings.NeuroProvidersPane.save', 'Save provider')}
          </Button>
        </div>
      </div>
    </SearchableSetting>
  )
}
