import { Link } from 'react-router-dom';
import PageBanner from '../components/PageBanner';
import Section from '../components/Section';
import { admissionsContent } from '../content/siteContent';

export default function Admissions() {
  return (
    <>
      <PageBanner title="Admissions" subtitle={admissionsContent.intro} />

      {/* Steps */}
      <Section>
        <h2 className="font-display text-2xl font-bold mb-10 text-center">How to Apply</h2>
        <div className="max-w-3xl mx-auto space-y-8">
          {admissionsContent.steps.map((s) => (
            <div key={s.step} className="flex gap-5">
              <div className="w-10 h-10 rounded-full bg-emerald-700 text-white font-bold flex items-center justify-center shrink-0">
                {s.step}
              </div>
              <div>
                <h3 className="font-semibold text-lg mb-1">{s.title}</h3>
                <p className="text-gray-600 text-sm">{s.description}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Tuition note */}
      <Section dark>
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="font-display text-2xl font-bold mb-4">Tuition & Financial Aid</h2>
          <p className="text-gray-700 mb-6">{admissionsContent.tuitionNote}</p>
          <Link
            to="/contact"
            className="inline-block px-6 py-3 bg-emerald-700 text-white font-semibold rounded-lg hover:bg-emerald-800 transition-colors"
          >
            Contact Admissions
          </Link>
        </div>
      </Section>

      {/* Application form placeholder */}
      <Section>
        <div className="max-w-2xl mx-auto">
          <h2 className="font-display text-2xl font-bold mb-6 text-center">Online Application</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              alert('Application submitted! (Demo — backend integration pending)');
            }}
            className="space-y-5"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Parent / Guardian Name" name="parentName" required />
              <Field label="Email Address" name="email" type="email" required />
              <Field label="Phone Number" name="phone" type="tel" required />
              <Field label="Student Name" name="studentName" required />
              <Field label="Grade Applying For" name="grade" required />
              <Field label="Current School" name="currentSchool" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Additional Information</label>
              <textarea
                name="notes"
                rows={4}
                className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              />
            </div>
            <button
              type="submit"
              className="w-full py-3 bg-emerald-700 text-white font-semibold rounded-lg hover:bg-emerald-800 transition-colors"
            >
              Submit Application
            </button>
          </form>
        </div>
      </Section>
    </>
  );
}

function Field({
  label,
  name,
  type = 'text',
  required,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium text-gray-700 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
      />
    </div>
  );
}
