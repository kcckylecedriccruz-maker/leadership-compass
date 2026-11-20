// Unit tests for the AI data preparation (runs under Vitest; no network, no database).
import { describe, expect, it } from 'vitest';
import { groupOf, overall, Pseudonyms, sample, scoreCompetencies, type Answer, type Competency } from './data';

const competencies: Competency[] = [
  { id: 'c1', sort_order: 1, category: 'Leading Self', name: 'Self-Awareness', definition: '' },
  { id: 'c2', sort_order: 2, category: 'Leading Others', name: 'Coaching', definition: '' },
];

describe('rater groups', () => {
  it('folds skip-level kinds into managers and direct reports', () => {
    expect(groupOf('self')).toBe('Self');
    expect(groupOf('immediate_manager')).toBe('Managers');
    expect(groupOf('skip_level_manager')).toBe('Managers');
    expect(groupOf('direct_report')).toBe('Direct reports');
    expect(groupOf('skip_level_report')).toBe('Direct reports');
    expect(groupOf('external')).toBe('External');
    expect(groupOf('peer')).toBe('Peers');
  });
});

describe('scores sent to the AI', () => {
  it('averages self separately from everyone else, per group', () => {
    const answers: Answer[] = [
      { talentId: 't', group: 'Self', competencyId: 'c1', rating: 5, note: '' },
      { talentId: 't', group: 'Managers', competencyId: 'c1', rating: 3, note: '' },
      { talentId: 't', group: 'Peers', competencyId: 'c1', rating: 4, note: '' },
      { talentId: 't', group: 'Peers', competencyId: 'c1', rating: 2, note: '' },
    ];
    const [awareness, coaching] = scoreCompetencies(answers, competencies);
    expect(awareness.self).toBe(5);
    expect(awareness.others).toBe(3);
    expect(awareness.byGroup).toEqual({ Self: 5, Managers: 3, Peers: 3 });
    expect(coaching.others).toBeNull();
    expect(overall([awareness, coaching])).toEqual({ others: 3, self: 5 });
  });
});

describe('privacy: people become codes', () => {
  it('gives each person a stable code and restores names only in the answer', () => {
    const codes = new Pseudonyms();
    const a = codes.code('id-a', 'Maria Santos');
    const b = codes.code('id-b', 'Juan Dela Cruz');
    expect(a).toBe('[P1]');
    expect(b).toBe('[P2]');
    expect(codes.code('id-a', 'Maria Santos')).toBe('[P1]');
    const restored = codes.restore({ answer: `${a} improved most; ${b} did not.`, list: [b], unknown: '[P9]' });
    expect(restored).toEqual({ answer: 'Maria Santos improved most; Juan Dela Cruz did not.', list: ['Juan Dela Cruz'], unknown: '[P9]' });
  });
});

describe('note sampling', () => {
  it('keeps everything under the limit and spreads evenly over it', () => {
    expect(sample([1, 2, 3], 5)).toEqual([1, 2, 3]);
    const picked = sample(Array.from({ length: 100 }, (_, i) => i), 10);
    expect(picked).toHaveLength(10);
    expect(picked[0]).toBe(0);
    expect(picked[9]).toBe(90);
  });
});
