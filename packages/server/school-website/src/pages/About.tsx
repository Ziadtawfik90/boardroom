import PageBanner from '../components/PageBanner';
import Section from '../components/Section';
import { aboutContent } from '../content/siteContent';

export default function About() {
  return (
    <>
      <PageBanner title="About Crestwood" subtitle="Our mission, values, and story." />

      <Section>
        <div className="max-w-3xl mx-auto space-y-12">
          <div>
            <h2 className="font-display text-2xl font-bold mb-4">Our Mission</h2>
            <p className="text-gray-700 leading-relaxed">{aboutContent.mission}</p>
          </div>
          <div>
            <h2 className="font-display text-2xl font-bold mb-4">Our Vision</h2>
            <p className="text-gray-700 leading-relaxed">{aboutContent.vision}</p>
          </div>
        </div>
      </Section>

      <Section dark>
        <h2 className="font-display text-2xl font-bold mb-8 text-center">Core Values</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-4xl mx-auto">
          {aboutContent.values.map((v) => (
            <div key={v.name} className="bg-white p-6 rounded-xl border border-gray-100">
              <h3 className="font-semibold text-lg text-emerald-800 mb-2">{v.name}</h3>
              <p className="text-gray-600 text-sm">{v.description}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section>
        <div className="max-w-3xl mx-auto">
          <h2 className="font-display text-2xl font-bold mb-4">Our History</h2>
          <p className="text-gray-700 leading-relaxed">{aboutContent.history}</p>
        </div>
      </Section>
    </>
  );
}
