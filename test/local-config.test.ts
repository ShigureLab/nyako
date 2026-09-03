import { describe, expect, it } from 'vite-plus/test'
import { resolveLocalConfigPath } from '../tools/local-config.ts'

describe('local config path', () => {
  it('uses the runtime-provided config path when available', () => {
    expect(
      resolveLocalConfigPath('/unused/home', {
        NYAKORE_CONFIG_PATH: '/runtime/local/config.toml',
      })
    ).toBe('/runtime/local/config.toml')
  })

  it('falls back to the user runtime home outside a runtime process', () => {
    expect(resolveLocalConfigPath('/example/home', {})).toBe('/example/home/.nyakore/config.toml')
  })
})
