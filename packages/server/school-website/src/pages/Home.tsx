import { Link } from 'react-router-dom';
import { Users, GraduationCap, Palette, Shield } from 'lucide-react';
import Section from '../components/Section';
import { heroContent, highlights } from '../content/siteContent';

const iconMap: Record<string, typeof Users> = { Users, GraduationCap, Palette, Shield };

export default function Home() {
  return (
    <>
      {/* Hero */}
      <div className="relative bg-emerald-900 text-white overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-900 via-emerald-800 to-emerald-950" />
        <div className="relative max-w-7xl mx-auto px-4 py-24 md:py-36 text-center">
          <h1 className="font-display text-4xl md:text-6xl font-bold mb-6 leading-tight">
            {heroContent.headline}
          </h1>
          <p className="text-emerald-100 text-lg md:text-xl max-w-2xl mx-auto mb-10">
            {heroContent.subheadline}
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              to={heroContent.ctaHref}
              className="px-8 py-3 bg-white text-emerald-900 font-semibold rounded-lg hover:bg-emerald-50 transition-colors"
            >
              {heroContent.ctaText}
            </Link>
            <Link
              to={heroContent.secondaryCtaHref}
              className="px-8 py-3 border-2 border-white/40 text-white font-semibold rounded-lg hover:bg-white/10 transition-colors"
            >
              {heroContent.secondaryCtaText}
            </Link>
          </div>
        </div>
      </div>

      {/* Highlights */}
      <Section>
        <div className="text-center mb-12">
          <h2 className="font-display text-3xl font-bold text-gray-900 mb-3">Why Crestwood?</h2>
          <p className="text-gray-600 max-w-xl mx-auto">
            A tradition of academic excellence in a supportive, close-knit community.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {highlights.map((item) => {
            const Icon = iconMap[item.icon] ?? Users;
            return (
              <div key={item.title} className="text-center p-6 rounded-xl border border-gray-100 hover:shadow-md transition-shadow">
                <div className="w-14 h-14 bg-emerald-50 text-emerald-700 rounded-xl flex items-center justify-center mx-auto mb-4">
                  <Icon size={28} />
                </div>
                <h3 className="font-semibold text-lg mb-2">{item.title}</h3>
                <p className="text-gray-600 text-sm">{item.description}</p>
              </div>
            );
          })}
        </div>
      </Section>

      {/* CTA Banner */}
      <Section dark>
        <div className="text-center">
          <h2 className="font-display text-3xl font-bold text-gray-900 mb-4">
            Ready to Join Our Community?
          </h2>
          <p className="text-gray-600 max-w-xl mx-auto mb-8">
            Applications for the upcoming school year are now open. Take the first step toward a Crestwood education.
          </p>
          <Link
            to="/admissions"
            className="inline-block px-8 py-3 bg-emerald-700 text-white font-semibold rounded-lg hover:bg-emerald-800 transition-colors"
          >
            Start Your Application
          </Link>
        </div>
      </Section>
    </>
  );
}
