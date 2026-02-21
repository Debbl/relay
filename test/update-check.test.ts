import { describe, expect, it, vi } from 'vitest'
import {
  checkRelayPackageUpdate,
  compareSemverVersions,
} from '../src/core/update-check'

describe('compareSemverVersions', () => {
  it('compares stable versions', () => {
    expect(compareSemverVersions('1.2.0', '1.1.9')).toBeGreaterThan(0)
    expect(compareSemverVersions('1.2.0', '1.2.0')).toBe(0)
    expect(compareSemverVersions('1.1.9', '1.2.0')).toBeLessThan(0)
  })

  it('treats stable release as newer than prerelease', () => {
    expect(compareSemverVersions('1.2.0', '1.2.0-beta.1')).toBeGreaterThan(0)
    expect(compareSemverVersions('1.2.0-beta.1', '1.2.0')).toBeLessThan(0)
  })

  it('returns 0 for invalid semver values', () => {
    expect(compareSemverVersions('latest', '1.2.0')).toBe(0)
  })
})

describe('checkRelayPackageUpdate', () => {
  it('warns when npm latest is newer than current', async () => {
    const warn = vi.fn()
    let requestedUrl = ''
    let requestedTimeoutMs = -1

    await checkRelayPackageUpdate({
      packageName: '@debbl/relay',
      currentVersion: '0.0.3',
      timeoutMs: 1200,
      logger: { warn },
      requestJson: async (url, timeoutMs) => {
        requestedUrl = url.toString()
        requestedTimeoutMs = timeoutMs
        return {
          'dist-tags': {
            latest: '0.0.4',
          },
        }
      },
    })

    expect(requestedUrl).toBe('https://registry.npmjs.org/%40debbl%2Frelay')
    expect(requestedTimeoutMs).toBe(1200)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain('0.0.3 -> 0.0.4')
  })

  it('does not warn when current version is already latest', async () => {
    const warn = vi.fn()

    await checkRelayPackageUpdate({
      packageName: '@debbl/relay',
      currentVersion: '0.0.4',
      logger: { warn },
      requestJson: async () => {
        return {
          'dist-tags': {
            latest: '0.0.4',
          },
        }
      },
    })

    expect(warn).not.toHaveBeenCalled()
  })

  it('ignores registry failures', async () => {
    const warn = vi.fn()

    await checkRelayPackageUpdate({
      packageName: '@debbl/relay',
      currentVersion: '0.0.3',
      logger: { warn },
      requestJson: async () => {
        throw new Error('network down')
      },
    })

    expect(warn).not.toHaveBeenCalled()
  })
})
