import https from 'node:https'

const DEFAULT_REGISTRY_BASE_URL = 'https://registry.npmjs.org'
const DEFAULT_TIMEOUT_MS = 2500

export interface UpdateCheckLogger {
  warn: (message: string) => void
}

export type RequestRegistryJson = (
  url: URL,
  timeoutMs: number,
) => Promise<unknown>

export interface CheckRelayPackageUpdateOptions {
  packageName: string
  currentVersion: string
  timeoutMs?: number
  registryBaseUrl?: string
  requestJson?: RequestRegistryJson
  logger?: UpdateCheckLogger
}

interface ParsedSemver {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

export async function checkRelayPackageUpdate(
  options: CheckRelayPackageUpdateOptions,
): Promise<void> {
  const currentVersion = options.currentVersion.trim()
  if (currentVersion.length === 0) {
    return
  }

  const requestJson = options.requestJson ?? requestRegistryJson
  const logger = options.logger ?? console
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const registryBaseUrl = normalizeRegistryBaseUrl(
    options.registryBaseUrl ?? DEFAULT_REGISTRY_BASE_URL,
  )
  const packagePath = encodeURIComponent(options.packageName)
  const requestUrl = new URL(`${registryBaseUrl}/${packagePath}`)

  let payload: unknown
  try {
    payload = await requestJson(requestUrl, timeoutMs)
  } catch {
    return
  }

  const latestVersion = readLatestVersion(payload)
  if (latestVersion === undefined) {
    return
  }

  if (compareSemverVersions(latestVersion, currentVersion) <= 0) {
    return
  }

  logger.warn(
    `[relay] A new version of ${options.packageName} is available: ${currentVersion} -> ${latestVersion}. Run "npm i -g ${options.packageName}@latest".`,
  )
}

export function compareSemverVersions(left: string, right: string): number {
  const leftSemver = parseSemver(left)
  const rightSemver = parseSemver(right)

  if (leftSemver === null || rightSemver === null) {
    return 0
  }

  const coreDiff =
    compareNumber(leftSemver.major, rightSemver.major) ||
    compareNumber(leftSemver.minor, rightSemver.minor) ||
    compareNumber(leftSemver.patch, rightSemver.patch)
  if (coreDiff !== 0) {
    return coreDiff
  }

  return comparePrerelease(leftSemver.prerelease, rightSemver.prerelease)
}

function parseSemver(value: string): ParsedSemver | null {
  const normalized = value.trim()
  const semverPattern =
    /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/
  const match = semverPattern.exec(normalized)
  if (!match) {
    return null
  }

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  }
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) {
    return 0
  }
  if (left.length === 0) {
    return 1
  }
  if (right.length === 0) {
    return -1
  }

  const maxLength = Math.max(left.length, right.length)
  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = left[index]
    const rightPart = right[index]
    if (leftPart === undefined) {
      return -1
    }
    if (rightPart === undefined) {
      return 1
    }

    const compared = comparePrereleasePart(leftPart, rightPart)
    if (compared !== 0) {
      return compared
    }
  }

  return 0
}

function comparePrereleasePart(left: string, right: string): number {
  const numericPattern = /^\d+$/
  const leftIsNumeric = numericPattern.test(left)
  const rightIsNumeric = numericPattern.test(right)

  if (leftIsNumeric && rightIsNumeric) {
    return compareNumber(Number.parseInt(left, 10), Number.parseInt(right, 10))
  }
  if (leftIsNumeric) {
    return -1
  }
  if (rightIsNumeric) {
    return 1
  }

  return left.localeCompare(right)
}

function compareNumber(left: number, right: number): number {
  if (left === right) {
    return 0
  }
  return left > right ? 1 : -1
}

function readLatestVersion(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined
  }

  const distTags = payload['dist-tags']
  if (!isRecord(distTags)) {
    return undefined
  }

  const latest = distTags.latest
  if (typeof latest !== 'string') {
    return undefined
  }

  const normalized = latest.trim()
  if (normalized.length === 0) {
    return undefined
  }

  return normalized
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeRegistryBaseUrl(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

async function requestRegistryJson(
  url: URL,
  timeoutMs: number,
): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          accept: 'application/vnd.npm.install-v1+json',
        },
      },
      (response) => {
        const statusCode = response.statusCode ?? 0
        if (statusCode < 200 || statusCode >= 300) {
          response.resume()
          reject(new Error(`Unexpected npm registry response: ${statusCode}`))
          return
        }

        let body = ''
        response.setEncoding('utf-8')
        response.on('data', (chunk: string) => {
          body += chunk
        })
        response.on('end', () => {
          try {
            resolve(JSON.parse(body) as unknown)
          } catch (error) {
            reject(error)
          }
        })
        response.on('error', (error) => {
          reject(error)
        })
      },
    )

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error('Update check timed out.'))
    })
    request.on('error', (error) => {
      reject(error)
    })
  })
}
