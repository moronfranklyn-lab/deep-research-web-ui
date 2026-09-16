import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyAxiosProxyEnv,
  createProxyFetch,
  isAxiosCompatibleProxy,
  parseProxyUrl,
  redactProxyUrl,
  resolveProxyConfig,
  shouldBypassProxy,
} from '../server/utils/proxy.ts'

describe('parseProxyUrl', () => {
  it('parses http proxy with auth', () => {
    const parsed = parseProxyUrl('http://user:pass@gate.example.com:7777')
    assert.equal(parsed.protocol, 'http:')
    assert.equal(parsed.host, 'gate.example.com')
    assert.equal(parsed.port, 7777)
    assert.equal(parsed.username, 'user')
    assert.equal(parsed.password, 'pass')
  })

  it('accepts socks5h and keeps the scheme', () => {
    const parsed = parseProxyUrl('socks5h://u:p@eu.example.io:7777')
    assert.equal(parsed.protocol, 'socks5h:')
    assert.equal(parsed.port, 7777)
  })

  it('applies default ports', () => {
    assert.equal(parseProxyUrl('http://h').port, 8080)
    assert.equal(parseProxyUrl('https://h').port, 8080)
    assert.equal(parseProxyUrl('socks5://h').port, 1080)
    assert.equal(parseProxyUrl('socks5h://h').port, 1080)
  })

  it('rejects unsupported protocols and garbage', () => {
    assert.throws(() => parseProxyUrl('ftp://h:21'), /Unsupported proxy protocol/)
    assert.throws(() => parseProxyUrl('not a url'), /Invalid proxy URL/)
    assert.throws(() => parseProxyUrl(''), /Invalid proxy URL/)
  })

  it('asks for URL-encoding instead of throwing a raw URIError', () => {
    assert.throws(() => parseProxyUrl('http://u:100%@h:8080'), /URL-encoded/)
    const encoded = parseProxyUrl('http://u:100%25@h:8080')
    assert.equal(encoded.password, '100%')
  })
})

describe('redactProxyUrl', () => {
  it('never leaks credentials', () => {
    const redacted = redactProxyUrl('http://user:s3cret@gate.example.com:7777')
    assert.match(redacted, /gate\.example\.com/)
    assert.doesNotMatch(redacted, /s3cret/)
    assert.match(redacted, /\*\*\*/)
  })

  it('handles empty and invalid input without throwing', () => {
    assert.equal(redactProxyUrl(undefined), '(no proxy)')
    assert.equal(redactProxyUrl(''), '(no proxy)')
    assert.equal(redactProxyUrl('garbage'), '(invalid proxy url)')
  })
})

describe('shouldBypassProxy', () => {
  it('matches exact hosts and parent domains', () => {
    assert.equal(shouldBypassProxy('localhost', 'localhost,127.0.0.1'), true)
    assert.equal(shouldBypassProxy('api.example.com', 'example.com'), true)
    assert.equal(shouldBypassProxy('example.com', '.example.com'), true)
    assert.equal(shouldBypassProxy('other.com', 'example.com'), false)
  })

  it('does not let suffixes leak across domains', () => {
    assert.equal(shouldBypassProxy('notexample.com', 'example.com'), false)
  })

  it('supports wildcard and is case-insensitive', () => {
    assert.equal(shouldBypassProxy('anything.io', '*'), true)
    assert.equal(shouldBypassProxy('LOCALHOST', 'localhost'), true)
    assert.equal(shouldBypassProxy('h', ''), false)
    assert.equal(shouldBypassProxy('h', undefined), false)
  })
})

describe('resolveProxyConfig', () => {
  it('returns null without any proxy env', () => {
    const saved = { ...process.env }
    for (const key of [
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'ALL_PROXY',
      'http_proxy',
      'https_proxy',
      'all_proxy',
    ]) {
      delete process.env[key]
    }
    try {
      assert.equal(resolveProxyConfig({}), null)
    } finally {
      process.env = saved
    }
  })

  it('prefers explicit input and defaults NO_PROXY to localhost', () => {
    const resolved = resolveProxyConfig({ proxyUrl: 'http://u:p@h:8080' })
    assert.ok(resolved)
    assert.equal(resolved!.noProxy, 'localhost,127.0.0.1,::1')
  })

  it('falls back to standard env vars', () => {
    const savedHttp = process.env.HTTP_PROXY
    const savedNo = process.env.NO_PROXY
    for (const key of [
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'ALL_PROXY',
      'http_proxy',
      'https_proxy',
      'all_proxy',
    ]) {
      delete process.env[key]
    }
    process.env.HTTP_PROXY = 'http://u:p@env-proxy:8080'
    try {
      const resolved = resolveProxyConfig({})
      assert.ok(resolved)
      assert.equal(resolved!.proxy.host, 'env-proxy')
    } finally {
      if (savedHttp === undefined) delete process.env.HTTP_PROXY
      else process.env.HTTP_PROXY = savedHttp
      if (savedNo === undefined) delete process.env.NO_PROXY
      else process.env.NO_PROXY = savedNo
    }
  })

  it('fail-fast on explicit invalid input, ignores ambient garbage', () => {
    assert.throws(() => resolveProxyConfig({ proxyUrl: 'not a url' }), /Invalid proxy URL/)
    const saved = { ...process.env }
    for (const key of [
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'ALL_PROXY',
      'http_proxy',
      'https_proxy',
      'all_proxy',
    ]) {
      delete process.env[key]
    }
    process.env.HTTP_PROXY = 'not a url'
    try {
      assert.equal(resolveProxyConfig({}), null)
    } finally {
      process.env = saved
    }
  })
})

describe('axios proxy env', () => {
  it('only http(s) proxies are axios-compatible', () => {
    assert.equal(isAxiosCompatibleProxy(parseProxyUrl('http://h:8080')), true)
    assert.equal(isAxiosCompatibleProxy(parseProxyUrl('https://h:8080')), true)
    assert.equal(isAxiosCompatibleProxy(parseProxyUrl('socks5h://h:1080')), false)
  })

  it('applies env for http proxies without touching socks', () => {
    const saved = { ...process.env }
    try {
      const http = applyAxiosProxyEnv(
        resolveProxyConfig({ proxyUrl: 'http://u:p@h:8080', noProxy: 'local' }),
      )
      assert.equal(http.applied, true)
      assert.equal(process.env.HTTP_PROXY, 'http://u:p@h:8080')
      assert.equal(process.env.NO_PROXY, 'local')

      for (const key of [
        'HTTP_PROXY',
        'HTTPS_PROXY',
        'http_proxy',
        'https_proxy',
        'NO_PROXY',
        'no_proxy',
      ]) {
        delete process.env[key]
      }
      const socks = applyAxiosProxyEnv(resolveProxyConfig({ proxyUrl: 'socks5h://u:p@h:1080' }))
      assert.equal(socks.applied, false)
      assert.equal(process.env.HTTP_PROXY, undefined)
      assert.match(socks.reason, /axios/)
    } finally {
      process.env = saved
    }
  })
})

describe('proxy failure sanitizing', () => {
  it('redacts proxy password and API keys from the thrown cause', async () => {
    // Dead proxy on a closed localhost port: offline-safe, fails fast.
    const resolved = resolveProxyConfig({ proxyUrl: 'http://puser:pw-secret@127.0.0.1:9' })!
    const proxyFetch = createProxyFetch(resolved)
    const error = await proxyFetch('http://example.com/', {
      headers: { Authorization: 'Bearer sk-secret' },
      signal: AbortSignal.timeout(15000),
    }).then(
      () => null,
      (e: unknown) => e as Error,
    )
    assert.ok(error instanceof TypeError)
    assert.doesNotMatch(error.message, /pw-secret/)
    assert.doesNotMatch(error.message, /sk-secret/)
    const cause = (error as { cause?: unknown }).cause as {
      config?: { proxy?: { auth?: unknown }; headers?: { get?: (n: string) => string } }
    }
    assert.equal(cause?.config?.proxy?.auth, '(redacted)')
    assert.equal(cause?.config?.headers?.get?.('Authorization'), '(redacted)')
  })
})
