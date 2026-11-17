import type { AssignmentStatus, Classification, CycleStatus } from '@/lib/records';

export const CLASSIFICATION_LABELS: Record<Classification, string> = {
  immediate_manager: 'Immediate manager',
  direct_report: 'Direct report',
  peer: 'Peer',
  self: 'Self',
};

export const CLASSIFICATION_DESCRIPTIONS: Record<Classification, string> = {
  immediate_manager: 'The talent’s line manager.',
  direct_report: 'Someone who reports to the talent.',
  peer: 'A colleague working at a similar level.',
  self: 'The talent reflects on their own leadership.',
};

export const CYCLE_STATUS_LABELS: Record<CycleStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  closed: 'Closed',
};

export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  not_started: 'Not started',
  draft: 'Draft',
  submitted: 'Submitted',
};

const DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

export function formatDate(isoDate: string): string {
  return DATE_FORMATTER.format(new Date(isoDate));
}

export function toDateInputValue(isoDate: string): string {
  return isoDate.slice(0, 10);
}

export function pluralise(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysLeftLabel(closesAt: string, today: Date = new Date()): string {
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const days = Math.round((Date.parse(closesAt.slice(0, 10)) - todayUtc) / DAY_MS);
  if (days <= 0) return 'Closes today';
  return `${pluralise(days, 'day')} left`;
}
