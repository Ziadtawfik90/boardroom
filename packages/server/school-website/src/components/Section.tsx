import type { ReactNode } from 'react';

interface SectionProps {
  children: ReactNode;
  className?: string;
  dark?: boolean;
}

export default function Section({ children, className = '', dark }: SectionProps) {
  return (
    <section className={`py-16 md:py-20 ${dark ? 'bg-gray-50' : 'bg-white'} ${className}`}>
      <div className="max-w-7xl mx-auto px-4">{children}</div>
    </section>
  );
}
