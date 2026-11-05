import { useState } from 'react'
import {
  COPILOT_TOOL_GRANTS,
  MAX_COPILOT_PROMPT_CHARS,
  type CopilotToolGrant
} from '../../../../packages/neuro/src/copilots'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

/** Registration form for user-defined copilot personas; validation lives in the registry. */
export default function CopilotCustomForm(props: {
  tentacles: readonly string[]
  onRegister: (input: unknown) => void
}): React.JSX.Element {
  const [id, setId] = useState('')
  const [persona, setPersona] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [tentacle, setTentacle] = useState('Forge')
  const [grants, setGrants] = useState<readonly CopilotToolGrant[]>(['read-only'])
  const tentacleOptions =
    props.tentacles.length > 0 ? props.tentacles : ['Forge', 'Archivist', 'Verifier']
  return (
    <section className="mx-3 mb-4 grid gap-2 rounded-md border border-border p-3 md:mx-5">
      <div className="grid gap-2 md:grid-cols-3">
        <div className="grid gap-1">
          <Label htmlFor="copilot-custom-id">ID</Label>
          <Input
            id="copilot-custom-id"
            value={id}
            onChange={(event) => setId(event.target.value)}
            placeholder="my-copilot"
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="copilot-custom-persona">
            {translate('auto.components.neuro.CopilotPanel.personaLabel', 'Persona')}
          </Label>
          <Input
            id="copilot-custom-persona"
            value={persona}
            onChange={(event) => setPersona(event.target.value)}
            placeholder="Scout"
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="copilot-custom-tentacle">
            {translate('auto.components.neuro.CopilotPanel.tentacle', 'Tentacle')}
          </Label>
          <Select value={tentacle} onValueChange={setTentacle}>
            <SelectTrigger id="copilot-custom-tentacle" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {tentacleOptions.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="copilot-custom-prompt">
          {translate('auto.components.neuro.CopilotPanel.systemPrompt', 'System prompt')}
        </Label>
        <Textarea
          id="copilot-custom-prompt"
          value={systemPrompt}
          onChange={(event) => setSystemPrompt(event.target.value)}
          rows={2}
          maxLength={MAX_COPILOT_PROMPT_CHARS}
        />
      </div>
      <div className="flex flex-wrap gap-3" aria-label="Tool grants">
        {COPILOT_TOOL_GRANTS.map((grant) => (
          <label key={grant} className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={grants.includes(grant)}
              onChange={(event) =>
                setGrants((current) =>
                  event.target.checked
                    ? [...current, grant]
                    : current.filter((candidate) => candidate !== grant)
                )
              }
            />
            {grant}
          </label>
        ))}
      </div>
      <div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            props.onRegister({ id, persona, systemPrompt, toolGrants: grants, tentacle })
          }
        >
          {translate('auto.components.neuro.CopilotPanel.register', 'Register copilot')}
        </Button>
      </div>
    </section>
  )
}
