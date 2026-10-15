// @vitest-environment happy-dom
import {describe, it, expect, vi, afterEach} from 'vitest'
import {existsSync, readFileSync, readdirSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'

// Test the artifacts actually served by each app, rather than its linked source.
// The AidenLab build previously retained the old index-zero default after dist
// had been updated, opening chrA instead of the appended All chromosome.
afterEach(() => vi.restoreAllMocks())

for (const directory of ['dist', 'dist-aidenlab']) {
    describe(`${directory} whole-genome startup`, () => {
        it('opens a V10 file at its stored All index instead of chromosome zero', async () => {
            const assets = resolve(directory, 'assets')
            // dist-aidenlab is ignored by Git, so build it on a fresh checkout.
            if (!existsSync(assets)) execFileSync('npm', ['run', directory === 'dist' ? 'build' : 'build:aidenlab'], {stdio: 'pipe'})
            const filename = readdirSync(assets).find(name => /^juicebox-.*\.js$/.test(name))
            expect(filename).toBeDefined()
            const bundle = await import(/* @vite-ignore */ pathToFileURL(resolve(assets, filename)).href)
            const hic = Object.values(bundle).find(value => typeof value?.createBrowser === 'function')
            expect(hic).toBeDefined()
            const context = new Proxy({measureText: () => ({width: 0})}, {get: (target, name) => target[name] ?? (() => {})})
            vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
            const bytes = readFileSync(resolve('../juicebox.js/test/data/v10/pseudo-all.hic'))
            vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
                if (options?.method === 'HEAD') return new Response(null, {headers: {'Content-Length': String(bytes.length)}})
                const range = new Headers(options?.headers).get('range')
                const match = /bytes=(\d+)-(\d+)/.exec(range)
                if (!match) throw new Error(`Unexpected non-range request: ${_url}`)
                const start = Number(match[1]), end = Math.min(Number(match[2]), bytes.length - 1)
                return new Response(bytes.subarray(start, end + 1), {status: 206, headers: {
                    'Content-Range': `bytes ${start}-${end}/${bytes.length}`, 'Content-Length': String(end - start + 1)
                }})
            })
            const container = document.createElement('div')
            document.body.appendChild(container)
            const browser = await hic.createBrowser(container, {})
            try {
                vi.spyOn(browser, 'update').mockResolvedValue(undefined)
                vi.spyOn(browser.contactMatrixView, 'update').mockResolvedValue(undefined)
                vi.spyOn(browser.contactMatrixView, 'getViewDimensions').mockReturnValue({width: 500, height: 500})
                const dataset = await browser.loadHicFile({url: 'https://example.org/appended-all.v10.hic'}, true)
                expect(dataset).toBeDefined()
                expect(dataset.chromosomes[0].name).toBe('chrA')
                expect(dataset.wholeGenomeChromosome.index).toBe(2)
                expect(browser.isWholeGenome()).toBe(true)
                expect([browser.state.chr1, browser.state.chr2]).toEqual([2, 2])
            } finally {
                browser.dispose()
                container.remove()
            }
        })
    })
}
