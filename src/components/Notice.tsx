import type { ReactNode } from 'react';
import { AlertIcon } from './icons';

interface Props {
  tone?: 'error' | 'info' | 'warning';
  title: string;
  children?: ReactNode;
}

const TONES = {
  error: 'border-red-200 bg-red-50 text-red-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  info: 'border-sky-200 bg-sky-50 text-sky-900',
};

export function Notice({ tone = 'info', title, children }: Props) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex gap-2.5 rounded-xl border p-3 text-sm ${TONES[tone]}`}>
      <AlertIcon className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="font-semibold">{title}</p>
        {children && <div className="mt-1 text-xs">{children}</div>}
      </div>
    </div>
  );
}
