import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Modal } from '@/components/Modal';
import type { TourStep } from '@/features/tour/tourSteps';

type WelcomeTourProps = {
  steps: TourStep[];
  onClose: () => void;
};

export function WelcomeTour({ steps, onClose }: WelcomeTourProps) {
  const [index, setIndex] = useState(0);
  const step = steps[index];
  const isLast = index === steps.length - 1;

  return (
    <Modal title={step.title} description={`Step ${index + 1} of ${steps.length}`} onClose={onClose}>
      <div className="space-y-8">
        <p className="text-base leading-relaxed text-ink">{step.body}</p>

        <div className="flex items-center justify-center gap-2" role="group" aria-label="Tour progress">
          {steps.map((_, dotIndex) => (
            <button
              key={dotIndex}
              type="button"
              onClick={() => setIndex(dotIndex)}
              aria-label={`Go to step ${dotIndex + 1}`}
              aria-current={dotIndex === index ? 'step' : undefined}
              className={`h-2.5 rounded-full transition-all duration-200 ${
                dotIndex === index ? 'w-6 bg-primary' : 'w-2.5 bg-line hover:bg-ink-muted'
              }`}
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={onClose} className="text-sm font-semibold text-ink-muted hover:text-ink">
            Skip tour
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIndex((current) => Math.max(0, current - 1))}
              disabled={index === 0}
              className="btn-secondary px-3 py-2 disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Back
            </button>
            <button
              type="button"
              onClick={() => (isLast ? onClose() : setIndex((current) => current + 1))}
              className="btn-primary px-4 py-2"
            >
              {isLast ? 'Finish' : 'Next'}
              {!isLast && <ChevronRight className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
