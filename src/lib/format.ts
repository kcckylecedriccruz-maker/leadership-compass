import type { AssignmentStatus, Classification, CycleStatus } from '@/lib/records';

export const CLASSIFICATION_LABELS: Record<Classification, string> = {
  self: 'Self',
  immediate_manager: 'Immediate manager',
  skip_level_manager: 'Skip-level manager',
  direct_report: 'Direct report',
  skip_level_report: 'Skip-level report',
  peer: 'Peer',
  external: 'External',
};

export const CLASSIFICATION_DESCRIPTIONS: Record<Classification, string> = {
  self: 'The employee reflects on their own leadership.',
  immediate_manager: 'The employee’s line manager.',
  skip_level_manager: 'The manager’s manager.',
  direct_report: 'Someone who reports to the employee.',
  skip_level_report: 'Someone two levels below the employee.',
  peer: 'A colleague who works with the employee.',
  external: 'Someone outside the company, such as a client or partner.',
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
