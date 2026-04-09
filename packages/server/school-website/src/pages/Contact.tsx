import { Mail, Phone, MapPin } from 'lucide-react';
import PageBanner from '../components/PageBanner';
import Section from '../components/Section';
import { school, contactContent } from '../content/siteContent';

export default function Contact() {
  return (
    <>
      <PageBanner title="Contact Us" subtitle={contactContent.intro} />

      <Section>
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-12">
          {/* Contact info */}
          <div>
            <h2 className="font-display text-2xl font-bold mb-6">Get in Touch</h2>
            <div className="space-y-4 mb-8">
              <div className="flex items-start gap-3">
                <MapPin size={20} className="text-emerald-700 mt-0.5 shrink-0" />
                <span className="text-gray-700">{school.address}</span>
              </div>
              <div className="flex items-start gap-3">
                <Phone size={20} className="text-emerald-700 mt-0.5 shrink-0" />
                <span className="text-gray-700">{school.phone}</span>
              </div>
              <div className="flex items-start gap-3">
                <Mail size={20} className="text-emerald-700 mt-0.5 shrink-0" />
                <span className="text-gray-700">{school.email}</span>
              </div>
            </div>

            <h3 className="font-semibold text-lg mb-3">Departments</h3>
            <div className="space-y-3">
              {contactContent.departments.map((dept) => (
                <div key={dept.name} className="p-4 bg-gray-50 rounded-lg">
                  <div className="font-medium text-gray-900">{dept.name}</div>
                  <div className="text-sm text-gray-600">{dept.email} &middot; {dept.phone}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Contact form */}
          <div>
            <h2 className="font-display text-2xl font-bold mb-6">Send a Message</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                alert('Message sent! (Demo — backend integration pending)');
              }}
              className="space-y-4"
            >
              <div>
                <label htmlFor="contactName" className="block text-sm font-medium text-gray-700 mb-1">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  id="contactName"
                  name="name"
                  required
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                />
              </div>
              <div>
                <label htmlFor="contactEmail" className="block text-sm font-medium text-gray-700 mb-1">
                  Email <span className="text-red-500">*</span>
                </label>
                <input
                  id="contactEmail"
                  name="email"
                  type="email"
                  required
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                />
              </div>
              <div>
                <label htmlFor="contactSubject" className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
                <input
                  id="contactSubject"
                  name="subject"
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                />
              </div>
              <div>
                <label htmlFor="contactMessage" className="block text-sm font-medium text-gray-700 mb-1">
                  Message <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="contactMessage"
                  name="message"
                  rows={5}
                  required
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                />
              </div>
              <button
                type="submit"
                className="w-full py-3 bg-emerald-700 text-white font-semibold rounded-lg hover:bg-emerald-800 transition-colors"
              >
                Send Message
              </button>
            </form>
          </div>
        </div>
      </Section>
    </>
  );
}
