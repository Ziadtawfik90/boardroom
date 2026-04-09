import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import PageBanner from '../components/PageBanner';
import Section from '../components/Section';
import { faqContent } from '../content/siteContent';

export default function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <>
      <PageBanner title="Frequently Asked Questions" subtitle="Answers to the most common questions from prospective families." />

      <Section>
        <div className="max-w-3xl mx-auto divide-y divide-gray-200">
          {faqContent.map((item, i) => {
            const isOpen = openIndex === i;
            return (
              <div key={i} className="py-5">
                <button
                  onClick={() => setOpenIndex(isOpen ? null : i)}
                  className="w-full flex justify-between items-start text-left gap-4"
                >
                  <span className="font-semibold text-gray-900">{item.question}</span>
                  <ChevronDown
                    size={20}
                    className={`text-gray-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {isOpen && (
                  <p className="mt-3 text-gray-600 text-sm leading-relaxed">{item.answer}</p>
                )}
              </div>
            );
          })}
        </div>
      </Section>
    </>
  );
}
