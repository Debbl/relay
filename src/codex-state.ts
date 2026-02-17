import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { OpenProjectsResult } from './types'

export function getCodexGlobalStatePath(): string {
  return join(homedir(), '.codex', '.codex-global-state.json')
}

export async function listOpenProjects(): Promise<OpenProjectsResult> {
  const stateFilePath = getCodexGlobalStatePath()
  const raw = await readFile(stateFilePath, 'utf8')
  const parsed: unknown = JSON.parse(raw)

  const roots = readActiveWorkspaceRoots(parsed)
  return {
    roots,
    stateFilePath,
  }
}

function readActiveWorkspaceRoots(value: unknown): string[] {
  if (!isRecord(value)) {
    return []
  }

  const roots = value['active-workspace-roots']
  if (!Array.isArray(roots)) {
    return []
  }

  return roots.filter((item): item is string => typeof item === 'string')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
