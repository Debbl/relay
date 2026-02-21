import { name, version } from '../../package.json'

const DEFAULT_PACKAGE_NAME = '@debbl/relay'
const DEFAULT_PACKAGE_VERSION = '0.0.0'

export interface RelayPackageMetadata {
  name: string
  version: string
}

export function readRelayPackageMetadata(): RelayPackageMetadata {
  return {
    name: readPackageField(name, DEFAULT_PACKAGE_NAME),
    version: readPackageField(version, DEFAULT_PACKAGE_VERSION),
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
