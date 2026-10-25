import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

describe('Project setup', () => {
  it('phaser package is installed', () => {
    const phaserPath = require.resolve('phaser/package.json')
    expect(phaserPath).toBeDefined()
  })

  it('fast-check is importable', async () => {
    const fc = await import('fast-check')
    expect(fc).toBeDefined()
  })

  it('jsdom environment is active', () => {
    expect(typeof document).toBe('object')
    expect(document.createElement).toBeDefined()
  })
})
