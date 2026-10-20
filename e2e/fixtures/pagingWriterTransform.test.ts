import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { pagingWriterTransform } from './pagingWriterTransform'

it('instruments each actual writer boundary once and rejects source drift', () => {
  const source = readFileSync('src/renderer/src/store/chatHistoryWriter.ts', 'utf8')
  const transformed = pagingWriterTransform(source)
  for (const stage of ['published', 'queued', 'yielded', 'resumed'])
    expect(transformed.split(`__observePagingWriter?.('${stage}'`)).toHaveLength(2)
  expect(() => pagingWriterTransform('')).toThrow('Paging checkpoint anchor changed')
  expect(() => pagingWriterTransform(source + source)).toThrow('Paging checkpoint anchor changed')
})
