import type { BadgeTone } from '@/components/Badge';
import type { AssignmentStatus, CompetencyRecord } from '@/lib/records';

export const ITEM_COUNT = 19;

export const RATING_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: '1 Rarely' },
  { value: 2, label: '2 Sometimes' },
  { value: 3, label: '3 Often' },
  { value: 4, label: '4 Usually' },
  { value: 5, label: '5 Always' },
];

export const ASSIGNMENT_STATUS_TONES: Record<AssignmentStatus, BadgeTone> = {
  not_started: 'neutral',
  draft: 'warning',
  submitted: 'success',
};

export type Answer = { rating: number | null; note: string };
export type AnswerMap = Partial<Record<number, Answer>>;

export type SubmitItem = { sort_order: number; rating: number | null; behaviour_note: string | null };

export type CompetencyGroup = { category: string; competencies: CompetencyRecord[] };

export function completeAnswer(answer: Answer | undefined): { rating: number; note: string } | null {
  if (!answer || answer.rating === null) return null;
  const note = answer.note.trim();
  return note === '' ? null : { rating: answer.rating, note };
}

function hasPartialAnswer(answer: Answer | undefined): boolean {
  return answer !== undefined && completeAnswer(answer) === null && (answer.rating !== null || answer.note.trim() !== '');
}

export function countAnswered(answers: AnswerMap): number {
  let count = 0;
  for (let number = 1; number <= ITEM_COUNT; number += 1) {
    if (completeAnswer(answers[number])) count += 1;
  }
  return count;
}

export function partiallyAnsweredNumbers(answers: AnswerMap): number[] {
  const numbers: number[] = [];
  for (let number = 1; number <= ITEM_COUNT; number += 1) {
    if (hasPartialAnswer(answers[number])) numbers.push(number);
  }
  return numbers;
}

function toItem(number: number, answer: Answer | undefined): SubmitItem {
  return {
    sort_order: number,
    rating: answer?.rating ?? null,
    behaviour_note: answer?.note.trim() || null,
  };
}

export function toDraftPayload(answers: AnswerMap): SubmitItem[] {
  const items: SubmitItem[] = [];
  for (let number = 1; number <= ITEM_COUNT; number += 1) {
    const answer = answers[number];
    if (answer) items.push(toItem(number, answer));
  }
  return items;
}

export function toSubmitPayload(answers: AnswerMap): SubmitItem[] {
  const items: SubmitItem[] = [];
  for (let number = 1; number <= ITEM_COUNT; number += 1) {
    items.push(toItem(number, answers[number]));
  }
  return items;
}

export function groupCompetencies(competencies: CompetencyRecord[]): CompetencyGroup[] {
  const sorted = [...competencies].sort((a, b) => a.sort_order - b.sort_order);
  const groups: CompetencyGroup[] = [];
  for (const competency of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.category === competency.category) {
      last.competencies.push(competency);
    } else {
      groups.push({ category: competency.category, competencies: [competency] });
    }
  }
  return groups;
}

export function listItemNumbers(numbers: number[]): string {
  if (numbers.length <= 1) return numbers.join('');
  return `${numbers.slice(0, -1).join(', ')} and ${numbers[numbers.length - 1]}`;
}
