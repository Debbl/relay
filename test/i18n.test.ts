import { generateMessageId } from '@lingui/message-utils/generateMessageId'
import { describe, expect, it } from 'vitest'
import { messages as enMessages } from '../src/i18n/locales/en/messages'
import { MESSAGES } from '../src/i18n/messages'

describe('i18n catalogs', () => {
  it('contains all runtime source messages in en catalog', () => {
    const catalog = enMessages as Record<string, string>

    for (const message of Object.values(MESSAGES)) {
      const id = generateMessageId(message)
      expect(catalog[id]).toBeDefined()
    }
  })
})
