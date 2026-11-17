import type { ActionRow, ScoreRow } from '@/features/reports/reportData';

export const BELOW_THRESHOLD = 3.0;
export const TARGET_SCORE = 5;

export type FocusArea = {
  score: ScoreRow;
  reason: string;
  action: ActionRow | null;
};

export type Recommendations = {
  focusAreas: FocusArea[];
  blindSpots: ScoreRow[];
  strengths: ScoreRow[];
};

export const TIMELINE = [
  { days: 30, text: 'Agree your focus areas with your manager and choose the first on-the-job action for each.' },
  { days: 60, text: 'Hold one coaching conversation per focus area and ask for specific feedback on progress.' },
  { days: 90, text: 'Complete the learning step for each focus area and apply it in your work.' },
  { days: 180, text: 'Ask the two raters who gave examples to re-rate you, and compare against your baseline.' },
  { days: 360, text: 'Review the full cycle with your manager and set the next assessment date.' },
];

export function buildRecommendations(scores: ScoreRow[], actions: ActionRow[]): Recommendations {
  const rated = scores.filter((row): row is ScoreRow & { others_score: number } => row.others_score !== null);
  const actionByCompetency = new Map(actions.map((row) => [row.competency_id, row]));

  const focusCandidates = [...rated].sort((a, b) => {
    const belowA = a.others_score < BELOW_THRESHOLD ? 0 : 1;
    const belowB = b.others_score < BELOW_THRESHOLD ? 0 : 1;
    return belowA - belowB || a.others_score - b.others_score;
  });

  const focusAreas: FocusArea[] = focusCandidates.slice(0, 3).map((row) => ({
    score: row,
    reason: focusReason(row),
    action: actionByCompetency.get(row.competency_id) ?? null,
  }));

  const blindSpots = scores
    .filter((row) => row.perception === 'Blind spot')
    .sort((a, b) => differenceOf(b) - differenceOf(a))
    .slice(0, 2);

  const strengths = [...rated]
    .filter((row) => row.others_score >= BELOW_THRESHOLD)
    .sort((a, b) => b.others_score - a.others_score)
    .slice(0, 2);

  return { focusAreas, blindSpots, strengths };
}

function differenceOf(row: ScoreRow): number {
  if (row.self_score === null || row.others_score === null) return 0;
  return row.self_score - row.others_score;
}

function focusReason(row: ScoreRow & { others_score: number }): string {
  const others = row.others_score.toFixed(1);
  const gap = (TARGET_SCORE - row.others_score).toFixed(1);
  if (row.others_score < BELOW_THRESHOLD) {
    return `Others scored this ${others}, below the ${BELOW_THRESHOLD.toFixed(1)} threshold, a gap of ${gap} from ${TARGET_SCORE.toFixed(1)}.`;
  }
  return `Others scored this ${others}, one of your three largest gaps, a gap of ${gap} from ${TARGET_SCORE.toFixed(1)}.`;
}
