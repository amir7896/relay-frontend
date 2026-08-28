import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const STORAGE_KEY = 'relay.tour.done';

const steps = [
  {
    target: '.inbox',
    title: 'Your inbox',
    body: 'All direct messages and groups live here. Pin, mute, and search chats.',
  },
  {
    target: '.thread',
    title: 'Live thread',
    body: 'Typing, seen receipts, reactions, replies, and voice notes update in real time.',
  },
  {
    target: '.composer',
    title: 'Rich composer',
    body: 'Attach images, record voice notes, @mention teammates, and use smart reply chips.',
  },
  {
    target: '.app-nav',
    title: 'Admin tools',
    body: 'Admins can open Analytics for live stats, audit logs, and workspace branding.',
  },
];

export function DemoTour() {
  const [step, setStep] = useState<number | null>(null);

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY) === '1') {
      return;
    }
    const timer = window.setTimeout(() => setStep(0), 800);
    return () => window.clearTimeout(timer);
  }, []);

  if (step === null || step >= steps.length) {
    return null;
  }

  const current = steps[step];
  const stepIndex = step;

  function finish() {
    localStorage.setItem(STORAGE_KEY, '1');
    setStep(null);
  }

  function next() {
    if (stepIndex >= steps.length - 1) {
      finish();
      return;
    }
    setStep(stepIndex + 1);
  }

  return (
    <div className="tour-overlay" role="dialog" aria-modal="true" aria-label="Product tour">
      <div className="tour-card">
        <p className="eyebrow">
          Step {stepIndex + 1} of {steps.length}
        </p>
        <h3>{current.title}</h3>
        <p>{current.body}</p>
        <div className="tour-actions">
          <button className="ghost" type="button" onClick={finish}>
            Skip tour
          </button>
          <button className="btn" type="button" onClick={next}>
            {stepIndex >= steps.length - 1 ? 'Done' : 'Next'}
          </button>
        </div>
        <Link className="muted tour-reset" to="/profile" onClick={finish}>
          Re-open later from Profile
        </Link>
      </div>
    </div>
  );
}

export function resetDemoTour() {
  localStorage.removeItem(STORAGE_KEY);
}
