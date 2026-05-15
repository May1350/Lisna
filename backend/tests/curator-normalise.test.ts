import { describe, it, expect } from 'vitest'
import { __testOnly_normaliseOutline } from '../src/lib/curator.js'

describe('curator outline normalisation — from field defaults', () => {
  it('legacy key_term without from defaults to transcript', () => {
    const raw = {
      title: 'X',
      sections: [{
        heading: 'A', ts: 0, summary: '',
        key_terms: [{ term: 't', definition: 'd', ts: 5 }],
        examples: [], points: [],
      }],
    }
    const out = __testOnly_normaliseOutline(raw)
    expect(out.sections[0].key_terms[0].from).toBe('transcript')
  })

  it('explicit from: inferred is preserved', () => {
    const raw = {
      title: 'X',
      sections: [{
        heading: 'A', ts: 0, summary: '',
        key_terms: [{ term: 't', definition: 'd', ts: 5, from: 'inferred' }],
        examples: [], points: [],
      }],
    }
    const out = __testOnly_normaliseOutline(raw)
    expect(out.sections[0].key_terms[0].from).toBe('inferred')
  })

  it('garbage from value (number, null) defaults to transcript', () => {
    const raw = {
      title: 'X',
      sections: [{
        heading: 'A', ts: 0, summary: '',
        key_terms: [{ term: 't', definition: 'd', ts: 5, from: 42 }],
        examples: [{ text: 'e', ts: 5, from: null }],
        points: [{ text: 'p', ts: 5, important: false, from: 'bogus' }],
      }],
    }
    const out = __testOnly_normaliseOutline(raw)
    expect(out.sections[0].key_terms[0].from).toBe('transcript')
    expect(out.sections[0].examples[0].from).toBe('transcript')
    expect(out.sections[0].points[0].from).toBe('transcript')
  })

  it('procedure_steps omitted when input has no procedure_steps key', () => {
    const raw = {
      title: 'X',
      sections: [{
        heading: 'A', ts: 0, summary: '',
        key_terms: [], examples: [], points: [],
      }],
    }
    const out = __testOnly_normaliseOutline(raw)
    expect(out.sections[0].procedure_steps).toBeUndefined()
  })

  it('procedure_steps with from preserved across array', () => {
    const raw = {
      title: 'X',
      sections: [{
        heading: 'A', ts: 0, summary: '',
        key_terms: [], examples: [], points: [],
        procedure_steps: [
          { text: 'step1', ts: 0 },
          { text: 'step2', ts: 1, from: 'inferred' },
        ],
      }],
    }
    const out = __testOnly_normaliseOutline(raw)
    expect(out.sections[0].procedure_steps).toHaveLength(2)
    expect(out.sections[0].procedure_steps![0].from).toBe('transcript')
    expect(out.sections[0].procedure_steps![1].from).toBe('inferred')
  })

  it('formula filters out empty expression items', () => {
    const raw = {
      title: 'X',
      sections: [{
        heading: 'A', ts: 0, summary: '',
        key_terms: [], examples: [], points: [],
        formula: [
          { expression: 'a=b', ts: 0 },
          { expression: '', ts: 1 },           // dropped
          { label: 'L', expression: 'x=y', ts: 2 },
        ],
      }],
    }
    const out = __testOnly_normaliseOutline(raw)
    expect(out.sections[0].formula).toHaveLength(2)
    expect(out.sections[0].formula![1].label).toBe('L')
  })
})
