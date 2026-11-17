/*
# Seed the 19 leadership competencies

Plain-English summary
Adds the fixed set of 19 leadership competencies across five categories (Leading Self, Leading Others, Leading the Business, Leading Change and Leading Self). Re-running this migration will not duplicate or overwrite rows.

## 1. Modified tables
- competencies: 19 rows inserted, numbered 1 to 19 by sort_order.

## Security
- No change to access rules. Competencies are readable by all signed-in users and cannot be edited through the app.

## Important notes
1. Matching is by sort_order, so existing rows are left untouched on re-run.
*/

INSERT INTO public.competencies (category, name, definition, sort_order) VALUES
  ('Leading Self', 'Self-Awareness', 'Understands own strengths, limits and emotions, and how they affect others.', 1),
  ('Leading Self', 'Emotional Resilience', 'Stays composed under pressure and recovers quickly from setbacks.', 2),
  ('Leading Self', 'Integrity & Ethics', 'Acts honestly and consistently, keeps commitments and does the right thing when it''s hard.', 3),
  ('Leading Self', 'Continuous Learning', 'Seeks feedback and new knowledge, and applies lessons to keep improving.', 4),
  ('Leading Self', 'Time & Energy Management', 'Prioritises the work that matters most and sustains energy for self and team.', 5),
  ('Leading Others', 'Coaching & Developing Others', 'Builds others'' capability through coaching, stretch work and growth conversations.', 6),
  ('Leading Others', 'Delegation & Empowerment', 'Hands over meaningful work with clear outcomes and the authority to deliver.', 7),
  ('Leading Others', 'Feedback & Recognition', 'Gives timely, specific feedback and recognises contributions.', 8),
  ('Leading Others', 'Conflict Management', 'Surfaces disagreement early and resolves it fairly and respectfully.', 9),
  ('Leading Others', 'Building Trust', 'Creates psychological safety through reliability, openness and care.', 10),
  ('Leading the Business', 'Strategic Thinking', 'Connects daily work to long-term direction and anticipates what''s coming.', 11),
  ('Leading the Business', 'Decision Making', 'Makes timely, well-reasoned decisions with the information available.', 12),
  ('Leading the Business', 'Business & Financial Acumen', 'Understands how the organisation creates value and uses financial data to guide choices.', 13),
  ('Leading the Business', 'Customer Focus', 'Puts customer needs at the centre of priorities and decisions.', 14),
  ('Leading the Business', 'Results Orientation', 'Sets high standards, drives accountability and delivers on goals.', 15),
  ('Leading Change', 'Change Advocacy', 'Explains the why behind change and builds genuine commitment to it.', 16),
  ('Leading Change', 'Managing Uncertainty', 'Moves forward and keeps others steady when the path is unclear.', 17),
  ('Leading Change', 'Innovation', 'Encourages new ideas and experiments, and learns from what doesn''t work.', 18),
  ('Leading Change', 'Sustaining Change', 'Embeds new ways of working so change lasts beyond the launch.', 19)
ON CONFLICT (sort_order) DO NOTHING;
