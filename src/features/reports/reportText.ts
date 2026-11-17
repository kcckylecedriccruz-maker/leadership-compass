import type { ReportData } from '@/features/reports/reportData';
import type { Recommendations } from '@/features/reports/recommendations';
import { formatScore } from '@/features/reports/reportFormat';

export function buildReportText(data: ReportData, recommendations: Recommendations): string {
  const lines: string[] = [];
  lines.push(`Leadership Compass: ${data.talentName}`);
  lines.push(`Cycle: ${data.cycle.name}`);
  lines.push('');
  lines.push(`Readiness: ${data.readiness.status}`);
  lines.push(`Overall gap: ${formatScore(data.readiness.overall_gap)}`);
  lines.push('');
  lines.push('Scores (Self / Others, band, perception)');
  for (const row of data.scores) {
    lines.push(
      `- ${row.category}: ${row.competency_name}: ${formatScore(row.self_score)} / ${formatScore(row.others_score)}, ${row.band ?? 'Not rated'}, ${row.perception ?? '-'}`,
    );
  }
  lines.push('');
  lines.push('Focus areas');
  if (recommendations.focusAreas.length === 0) lines.push('- Not enough feedback yet.');
  for (const area of recommendations.focusAreas) {
    lines.push(`- ${area.score.competency_name}. ${area.reason}`);
    if (area.action) {
      lines.push(`  On the job: ${area.action.on_the_job}`);
      lines.push(`  Coaching and feedback: ${area.action.coaching}`);
      lines.push(`  Learning: ${area.action.learning}`);
      lines.push(`  Measure of success: ${area.action.measure}`);
    }
  }
  lines.push('');
  lines.push('Blind spots');
  if (recommendations.blindSpots.length === 0) lines.push('- None found.');
  for (const row of recommendations.blindSpots) {
    lines.push(`- ${row.competency_name}: self ${formatScore(row.self_score)}, others ${formatScore(row.others_score)}`);
  }
  lines.push('');
  lines.push('Strengths to leverage');
  for (const row of recommendations.strengths) {
    lines.push(`- ${row.competency_name} (Others ${formatScore(row.others_score)})`);
  }
  lines.push('');
  lines.push('Timeline: 30, 60, 90, 180 and 360 days, as set out in the report.');
  return lines.join('\n');
}
