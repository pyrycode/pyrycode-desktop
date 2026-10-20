import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { pagingWriterTransform, pagingProtectedReadTransform, pagingAdmissionTransform } from './pagingWriterTransform'

it('instruments each actual writer boundary once and rejects source drift', () => {
  const source = readFileSync('src/renderer/src/store/chatHistoryWriter.ts', 'utf8')
  const transformed = pagingWriterTransform(source)
  for (const stage of ['published', 'queued', 'submitting', 'settled', 'yielded', 'resumed'])
    expect(transformed.split(`__observePagingWriter?.('${stage}'`)).toHaveLength(2)
  expect(() => pagingWriterTransform('')).toThrow('Paging checkpoint anchor changed')
  expect(() => pagingWriterTransform(source + source)).toThrow('Paging checkpoint anchor changed')
})

it('observes serialized admission and storage completion without changing the handler result', () => {
  const source = readFileSync('src/main/chatHistoryHandler.ts', 'utf8')
  const transformed = pagingAdmissionTransform(source)
  for (const stage of ['admitted', 'storage-completed'])
    expect(transformed.split(`__observePagingAdmission?.('${stage}'`)).toHaveLength(2)
  expect(transformed).toContain('return result')
  expect(() => pagingAdmissionTransform('')).toThrow('Paging checkpoint anchor changed')
  expect(() => pagingAdmissionTransform(source + source)).toThrow('Paging checkpoint anchor changed')
})

it('observes the authenticated header before its unchanged pending-save rejection', () => {
  const source = readFileSync('src/main/indexedThreadHistory.ts', 'utf8')
  const transformed = pagingProtectedReadTransform(source)
  expect(transformed.split('__observeProtectedPaging?.(')).toHaveLength(2)
  expect(transformed.indexOf('__observeProtectedPaging?.(')).toBeLessThan(transformed.indexOf('if (h.persistence) throw'))
  expect(() => pagingProtectedReadTransform('')).toThrow('Paging checkpoint anchor changed')
  expect(() => pagingProtectedReadTransform(source + source)).toThrow('Paging checkpoint anchor changed')
})
