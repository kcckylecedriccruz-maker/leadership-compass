import { describe, expect, it } from 'vitest';
import {
  completeAnswer,
  countAnswered,
  ITEM_COUNT,
  partiallyAnsweredNumbers,
  toDraftPayload,
  toSubmitPayload,
  type AnswerMap,
} from '@/features/assessments/assessmentModel';

describe('assessment answers', () => {
  it('treats an answer as complete only with a rating and a non-blank note', () => {
    expect(completeAnswer({ rating: 4, note: '  Ran the client meeting well  ' })).toEqual({ rating: 4, note: 'Ran the client meeting well' });
    expect(completeAnswer({ rating: 4, note: '   ' })).toBeNull();
    expect(completeAnswer({ rating: null, note: 'A note' })).toBeNull();
    expect(completeAnswer(undefined)).toBeNull();
  });

  it('counts complete answers and lists partly answered items', () => {
    const answers: AnswerMap = {
      1: { rating: 5, note: 'Clear example' },
      2: { rating: 3, note: '' }, // rating only
      3: { rating: null, note: 'Note only' }, // note only
      7: { rating: 2, note: 'Another example' },
    };
    expect(countAnswered(answers)).toBe(2);
    expect(partiallyAnsweredNumbers(answers)).toEqual([2, 3]);
  });

  it('sends every item on submit but only touched items in a draft', () => {
    const answers: AnswerMap = { 3: { rating: 4, note: ' Kept the team calm ' } };
    const submit = toSubmitPayload(answers);
    expect(submit).toHaveLength(ITEM_COUNT);
    expect(submit[2]).toEqual({ sort_order: 3, rating: 4, behaviour_note: 'Kept the team calm' });
    expect(submit[0]).toEqual({ sort_order: 1, rating: null, behaviour_note: null });
    expect(toDraftPayload(answers)).toEqual([{ sort_order: 3, rating: 4, behaviour_note: 'Kept the team calm' }]);
  });
});
