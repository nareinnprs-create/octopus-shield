import { useCallback, useEffect, useState } from 'react'
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { NEURO_BUILTIN_PROFILES } from '../../../../shared/neuro-provider-types'
import type {
  NeuroConnectionTestResult,
  NeuroProviderProfile,
  NeuroProviderStatus
} from '../../../../shared/neuro-provider-types'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { NeuroProviderEditor } from './neuro-provider-editor'

function draftFrom(template: NeuroProviderProfile): NeuroProviderProfile {
  return { ...template, id: template.id === 'ollama' ? 'ollama' : '', name: template.name }
}

function modelsFromText(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((model) => model.trim())
    .filter((model) => model.length > 0)
}

export function NeuroProvidersPane(): React.JSX.Element {
  const [status, setStatus] = useState<NeuroProviderStatus | null>(null)
  const [draft, setDraft] = useState<NeuroProviderProfile | null>(null)
  const [modelsText, setModelsText] = useState('')
  const [keyDraft, setKeyDraft] = useState('')
  const [testResult, setTestResult] = useState<NeuroConnectionTestResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setStatus(await window.api.neuroProviders.getStatus())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const startEdit = (profile: NeuroProviderProfile): void => {
    setDraft({ ...profile })
    setModelsText(profile.models.join('\n'))
    setKeyDraft('')
    setTestResult(null)
    setError(null)
  }

  const closeEditor = (): void => {
    setDraft(null)
  }

  const runAction = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const saveProfile = (): Promise<void> =>
    runAction(async () => {
      if (draft === null) {
        return
      }
      setStatus(
        await window.api.neuroProviders.save({ ...draft, models: modelsFromText(modelsText) })
      )
      closeEditor()
    })

  const saveKey = (): Promise<void> =>
    runAction(async () => {
      if (draft === null || !keyDraft.trim()) {
        return
      }
      await window.api.neuroProviders.saveApiKey(draft.id, keyDraft)
      setKeyDraft('')
      await refresh()
    })

  const forgetKey = (): Promise<void> =>
    runAction(async () => {
      if (draft === null) {
        return
      }
      await window.api.neuroProviders.clearApiKey(draft.id)
      await refresh()
    })

  const removeProfile = (id: string): Promise<void> =>
    runAction(async () => {
      setStatus(await window.api.neuroProviders.remove(id))
      if (draft?.id === id) {
        closeEditor()
      }
    })

  const testDraft = (): Promise<void> =>
    runAction(async () => {
      if (draft === null) {
        return
      }
      setTestResult(null)
      setTestResult(
        await window.api.neuroProviders.test({
          profile: { ...draft, models: modelsFromText(modelsText) },
          key: keyDraft.trim() || undefined
        })
      )
    })

  const keyStored = draft !== null && (status?.keyConfigured[draft.id] ?? false)

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.NeuroProvidersPane.intro',
            'Endpoint profiles for chat completions. Keys are stored in the encrypted Shield credential vault, never in plaintext.'
          )}
        </p>
        <div className="flex shrink-0 gap-2">
          {NEURO_BUILTIN_PROFILES.map((template) => (
            <Button
              key={template.id}
              variant="outline"
              size="xs"
              disabled={busy}
              onClick={() => startEdit(draftFrom(template))}
            >
              <Plus className="size-3" />
              {template.id === 'ollama'
                ? translate('auto.components.settings.NeuroProvidersPane.addOllama', 'Add Ollama')
                : translate(
                    'auto.components.settings.NeuroProvidersPane.addOpenAiCompatible',
                    'Add OpenAI-compatible'
                  )}
            </Button>
          ))}
        </div>
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {status === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          {translate('auto.components.settings.NeuroProvidersPane.loading', 'Loading providers...')}
        </div>
      ) : (
        <div className="space-y-2">
          {status.profiles.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/60 bg-card/30 p-6 text-center text-sm text-muted-foreground">
              {translate(
                'auto.components.settings.NeuroProvidersPane.empty',
                'No custom providers yet. Add Ollama for offline models, or an OpenAI-compatible endpoint.'
              )}
            </div>
          ) : (
            status.profiles.map((profile) => (
              <div
                key={profile.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-card/30 p-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{profile.name}</p>
                    <Badge variant="outline">{profile.kind}</Badge>
                    {profile.authScheme !== 'none' ? (
                      <Badge variant={status.keyConfigured[profile.id] ? 'secondary' : 'outline'}>
                        {status.keyConfigured[profile.id]
                          ? translate(
                              'auto.components.settings.NeuroProvidersPane.keySaved',
                              'Key saved'
                            )
                          : translate(
                              'auto.components.settings.NeuroProvidersPane.noKey',
                              'No key'
                            )}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {profile.baseUrl}
                    {profile.chatPath}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {profile.models.length > 0
                      ? profile.models.join(', ')
                      : translate(
                          'auto.components.settings.NeuroProvidersPane.noModels',
                          'No models listed'
                        )}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="xs" onClick={() => startEdit(profile)}>
                    <Pencil className="size-3" />
                    {translate('auto.components.settings.NeuroProvidersPane.edit', 'Edit')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={busy}
                    onClick={() => void removeProfile(profile.id)}
                  >
                    <Trash2 className="size-3" />
                    {translate('auto.components.settings.NeuroProvidersPane.remove', 'Remove')}
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {draft !== null ? (
        <NeuroProviderEditor
          draft={draft}
          modelsText={modelsText}
          keyDraft={keyDraft}
          busy={busy}
          testResult={testResult}
          keyStored={keyStored}
          keyPlaintext={status?.keyProtection[draft.id] === 'plaintext'}
          idLocked={status?.profiles.some((profile) => profile.id === draft.id) === true}
          onDraftChange={setDraft}
          onModelsTextChange={setModelsText}
          onKeyDraftChange={setKeyDraft}
          onSave={() => void saveProfile()}
          onSaveKey={() => void saveKey()}
          onForgetKey={() => void forgetKey()}
          onTest={() => void testDraft()}
          onCancel={closeEditor}
        />
      ) : null}
    </div>
  )
}
