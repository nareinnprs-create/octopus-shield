import { useEffect, useState } from 'react'
import type { ArmoryToolView } from '../../../../shared/armory-contract'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function ArmoryRunDialog(props: {
  tool: ArmoryToolView
  running: boolean
  onRun: (targets: readonly string[], args: readonly string[]) => void
  onClose: () => void
}): React.JSX.Element {
  const { tool, running, onRun, onClose } = props
  const [targets, setTargets] = useState('')
  const [args, setArgs] = useState('')

  useEffect(() => {
    setTargets('')
    setArgs('')
  }, [tool.id])

  const targetList = targets
    .split(',')
    .map((target) => target.trim())
    .filter((target) => target.length > 0)
  const argList = args.split(' ').filter((token) => token.length > 0)
  const canRun = !running && targetList.length > 0

  const submit = (): void => {
    if (canRun) {
      onRun(targetList, argList)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent surface="security" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">{tool.id}</DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.armory.ArmoryRunDialog.description',
              'Runs only after every target resolves inside the authorized scope. The run is audited.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="armory-run-targets">
              {translate('auto.components.armory.ArmoryRunDialog.targets', 'Targets')}
            </Label>
            <Input
              id="armory-run-targets"
              value={targets}
              onChange={(event) => setTargets(event.target.value)}
              placeholder="10.0.0.5, scanme.local"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={!running && targets.trim().length > 0 && targetList.length === 0}
              onKeyDown={(event) => event.key === 'Enter' && submit()}
            />
            <p className="text-2xs text-muted-foreground">
              {translate(
                'auto.components.armory.ArmoryRunDialog.targetsHint',
                'Comma-separated hostnames, IPs, or IPv4 CIDRs from OSHIELD_ARMORY_SCOPE.'
              )}
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="armory-run-args">
              {translate('auto.components.armory.ArmoryRunDialog.args', 'Arguments')}
            </Label>
            <Input
              id="armory-run-args"
              value={args}
              onChange={(event) => setArgs(event.target.value)}
              placeholder="-sV -p 1-1000"
              autoComplete="off"
              spellCheck={false}
              onKeyDown={(event) => event.key === 'Enter' && submit()}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={running}>
            {translate('auto.components.armory.ArmoryRunDialog.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={submit} disabled={!canRun}>
            {running
              ? translate('auto.components.armory.ArmoryRunDialog.running', 'Running…')
              : translate('auto.components.armory.ArmoryRunDialog.confirm', 'Run tool')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
