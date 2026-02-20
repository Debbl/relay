import process from 'node:process'
import type { OpenProjectsResult } from './types'

export async function listOpenProjects(): Promise<OpenProjectsResult> {
  return {
    roots: [process.cwd()],
  }
}
