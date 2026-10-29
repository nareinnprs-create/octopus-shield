import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DirEntry } from '../../../shared/filesystem-entry-types'
import {
  applyMarkdownTemplatePlaceholders,
  getMarkdownTemplateTitleForFileName,
  listMarkdownDocumentTemplates
} from './markdown-document-templates'

function entry(name: string, isDirectory = false, isSymlink = false): DirEntry {
  return { name, isDirectory, isSymlink }
}

function stubReadDir(entriesByPath: Record<string, DirEntry[]>): ReturnType<typeof vi.fn> {
  const readDir = vi.fn(async ({ dirPath }: { dirPath: string }) => {
    const entries = entriesByPath[dirPath]
    if (!entries) {
      throw new Error(`ENOENT: no such file or directory, scandir '${dirPath}'`)
    }
    return entries
  })

  vi.stubGlobal('window', {
    api: {
      fs: {
        pathExists: vi.fn(async ({ filePath }: { filePath: string }) => filePath in entriesByPath),
        readDir
      }
    }
  })

  return readDir
}

describe('markdown document templates', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('substitutes deterministic placeholders and leaves unknown placeholders intact', () => {
    const content = [
      '# {{ title }}',
      'Date: {{date}}',
      'Time: {{ time }}',
      'Date/time: {{datetime}}',
      'File: {{filename}}',
      'Unknown: {{owner}}'
    ].join('\n')

    expect(
      applyMarkdownTemplatePlaceholders(content, {
        title: 'Daily Note',
        filename: 'daily-note.md',
        now: new Date(2026, 4, 29, 7, 5)
      })
    ).toBe(
      [
        '# Daily Note',
        'Date: 2026-05-29',
        'Time: 07:05',
        'Date/time: 2026-05-29 07:05',
        'File: daily-note.md',
        'Unknown: {{owner}}'
      ].join('\n')
    )
  })

  it('folds whitespace-heavy pasted filenames without whitespace regex replacement', () => {
    const replace = vi.spyOn(String.prototype, 'replace')
    const nonBreakingSpace = String.fromCharCode(160)
    const fileName = `  launch___plan\t${nonBreakingSpace}${' pasted '.repeat(300)}.md`

    expect(getMarkdownTemplateTitleForFileName(fileName)).toBe(
      `Launch plan ${'pasted '.repeat(299)}pasted`
    )
    expect(
      replace.mock.calls.filter(
        ([pattern]) => pattern instanceof RegExp && pattern.source === '\\s+'
      )
    ).toHaveLength(0)
  })

  it('discovers markdown files under .shield/templates and skips unsafe entries', async () => {
    const readDir = stubReadDir({
      '/repo/.shield/templates': [
        entry('daily-note.md'),
        entry('scratch.txt'),
        entry('linked.md', false, true),
        entry('nested', true),
        entry('node_modules', true)
      ],
      '/repo/.shield/templates/nested': [entry('meeting.markdown'), entry('brief.mdx')]
    })

    await expect(
      listMarkdownDocumentTemplates(
        {
          target: { kind: 'local' as const },
          worktreeId: 'wt-1',
          worktreePath: '/repo',
          connectionId: 'conn-1'
        },
        '/repo'
      )
    ).resolves.toEqual([
      {
        id: '.shield/templates/nested/brief.mdx',
        name: 'Brief',
        filePath: '/repo/.shield/templates/nested/brief.mdx',
        relativePath: '.shield/templates/nested/brief.mdx',
        templateRelativePath: 'nested/brief.mdx',
        basename: 'brief.mdx'
      },
      {
        id: '.shield/templates/daily-note.md',
        name: 'Daily note',
        filePath: '/repo/.shield/templates/daily-note.md',
        relativePath: '.shield/templates/daily-note.md',
        templateRelativePath: 'daily-note.md',
        basename: 'daily-note.md'
      },
      {
        id: '.shield/templates/nested/meeting.markdown',
        name: 'Meeting',
        filePath: '/repo/.shield/templates/nested/meeting.markdown',
        relativePath: '.shield/templates/nested/meeting.markdown',
        templateRelativePath: 'nested/meeting.markdown',
        basename: 'meeting.markdown'
      }
    ])

    expect(readDir).toHaveBeenCalledWith({
      dirPath: '/repo/.shield/templates',
      connectionId: 'conn-1'
    })
  })

  it('returns an empty list when the template directory is missing', async () => {
    stubReadDir({})

    await expect(
      listMarkdownDocumentTemplates(
        { target: { kind: 'local' as const }, worktreeId: 'wt-1', worktreePath: '/repo' },
        '/repo'
      )
    ).resolves.toEqual([])
  })

  it('keeps Windows file paths native while exposing root-relative template paths', async () => {
    stubReadDir({
      'C:\\repo\\.shield\\templates': [entry('daily.md')]
    })

    await expect(
      listMarkdownDocumentTemplates(
        { target: { kind: 'local' as const }, worktreeId: 'wt-1', worktreePath: 'C:\\repo' },
        'C:\\repo'
      )
    ).resolves.toEqual([
      {
        id: '.shield/templates/daily.md',
        name: 'Daily',
        filePath: 'C:\\repo\\.shield\\templates\\daily.md',
        relativePath: '.shield/templates/daily.md',
        templateRelativePath: 'daily.md',
        basename: 'daily.md'
      }
    ])
  })
})
