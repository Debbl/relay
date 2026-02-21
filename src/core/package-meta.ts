import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const DEFAULT_PACKAGE_NAME = '@debbl/relay'
const DEFAULT_PACKAGE_VERSION = '0.0.0'

interface PackageJsonShape {
  name?: unknown
  version?: unknown
}

export interface RelayPackageMetadata {
  name: string
  version: string
}

export function readRelayPackageMetadata(): RelayPackageMetadata {
  const packageJsonPath = fileURLToPath(
    new URL('../../package.json', import.meta.url),
  )

  try {
    const raw = fs.readFileSync(packageJsonPath, 'utf-8')
    const parsed = JSON.parse(raw) as PackageJsonShape

    return {
      name: readPackageField(parsed.name, DEFAULT_PACKAGE_NAME),
      version: readPackageField(parsed.version, DEFAULT_PACKAGE_VERSION),
    }
  } catch {
    return {
      name: DEFAULT_PACKAGE_NAME,
      version: DEFAULT_PACKAGE_VERSION,
    }
  }
}

function readPackageField(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback
  }

  const normalized = value.trim()
  if (normalized.length === 0) {
    return fallback
  }

  return normalized
}
