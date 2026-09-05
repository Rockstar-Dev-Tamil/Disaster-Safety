import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/* A missing tile must 404, not fall through to index.html.
 *
 * Vite's dev server answers anything it cannot resolve with the SPA shell:
 * HTTP 200, content-type text/html. Every tile pyramid here is SPARSE by
 * construction -- 53 tiles cover the Kendrapara flood AOI, and MapLibre asks
 * for the whole viewport -- so each request outside the data returned an HTML
 * page where a PNG was expected and MapLibre logged
 *
 *     InvalidStateError: The source image could not be decoded
 *
 * eleven times on one page load. Nothing was actually broken; the console just
 * filled with failures that were not failures, which is worse than useless
 * when a real error needs to be spotted among them.
 *
 * This runs BEFORE Vite's own middlewares, so it must not answer for files
 * that exist -- it checks the public directory and calls next() when the file
 * is really there, leaving every genuine asset to Vite. Bundler-owned paths
 * are skipped outright: an image imported from src/ is served by the transform
 * pipeline and never exists at its request path on disk.
 *
 * Dev only. A static host already 404s these.
 */
function missingStaticAssets404(publicDir: string) {
  const ASSET = /\.(png|jpg|jpeg|webp|geojson|tif|tiff|bin)$/i
  const BUNDLER = /^\/(src|@fs|@id|@vite|node_modules)\//

  return {
    name: 'missing-static-assets-404',
    configureServer(server: {
      middlewares: {
        use: (
          fn: (
            req: { url?: string },
            res: { statusCode: number; end: (s?: string) => void },
            next: () => void,
          ) => void,
        ) => void
      }
    }) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0]
        if (!ASSET.test(url) || BUNDLER.test(url)) return next()

        /* Decode so a path with %20 resolves, and refuse to climb out of
         * public/ -- a 404 probe is not a reason to expose the filesystem. */
        let rel: string
        try {
          rel = decodeURIComponent(url).replace(/^\/+/, '')
        } catch {
          return next()
        }
        const full = path.resolve(publicDir, rel)
        if (!full.startsWith(path.resolve(publicDir))) return next()
        if (fs.existsSync(full)) return next()

        res.statusCode = 404
        res.end('not found')
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), missingStaticAssets404(path.resolve(__dirname, 'public'))],
  server: { port: 5180 },
})
