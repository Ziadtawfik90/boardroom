import { BookOpen } from 'lucide-react';
import PageBanner from '../components/PageBanner';
import Section from '../components/Section';
import { academicsContent } from '../content/siteContent';

export default function Academics() {
  return (
    <>
      <PageBanner title="Academics" subtitle={academicsContent.intro} />

      <Section>
        <div className="space-y-12 max-w-4xl mx-auto">
          {academicsContent.divisions.map((div) => (
            <div key={div.name} className="flex gap-6">
              <div className="hidden sm:flex w-14 h-14 bg-emerald-50 text-emerald-700 rounded-xl items-center justify-center shrink-0 mt-1">
                <BookOpen size={28} />
              </div>
              <div>
                <h2 className="font-display text-2xl font-bold mb-2">{div.name}</h2>
                <p className="text-gray-700 mb-4">{div.description}</p>
                <ul className="space-y-1">
                  {div.highlights.map((h) => (
                    <li key={h} className="flex items-start gap-2 text-sm text-gray-600">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                      {h}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}
