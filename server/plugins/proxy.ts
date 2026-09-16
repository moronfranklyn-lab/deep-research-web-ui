/**
 * Apply outbound proxy env for axios-based SDKs (Tavily / Firecrawl / CRW).
 * fetch-based paths (AI SDK, Google PSE, you.com) receive an explicit proxy
 * fetch per request instead; see `server/utils/proxy.ts`.
 *
 * Fail-fast: an invalid explicit `NUXT_PROXY_URL` throws here so Nitro
 * refuses to boot with a broken proxy config.
 */
import {
  applyAxiosProxyEnv,
  proxyEnvFromRuntimeConfig,
  redactProxyUrl,
  resolveProxyConfig,
} from '~~/server/utils/proxy'

export default defineNitroPlugin(() => {
  const proxyEnv = proxyEnvFromRuntimeConfig(useRuntimeConfig())
  let resolved: ReturnType<typeof resolveProxyConfig>
  try {
    resolved = resolveProxyConfig(proxyEnv)
  } catch (error) {
    throw new Error(
      `[proxy] Invalid NUXT_PROXY_URL, refusing to boot: ${error instanceof Error ? error.message : error}`,
    )
  }
  if (!resolved) return
  const axiosEnv = applyAxiosProxyEnv(resolved)
  console.info(
    `[proxy] Outbound proxy ${redactProxyUrl(proxyEnv.proxyUrl)} (NO_PROXY=${resolved.noProxy}); axios SDKs: ${axiosEnv.reason}`,
  )
  if (!axiosEnv.applied) {
    console.warn(`[proxy] ${axiosEnv.reason}`)
  }
})
