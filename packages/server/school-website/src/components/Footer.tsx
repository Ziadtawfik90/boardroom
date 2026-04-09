import { Link } from 'react-router-dom';
import { school, navigation } from '../content/siteContent';

export default function Footer() {
  return (
    <footer className="bg-gray-900 text-gray-300">
      <div className="max-w-7xl mx-auto px-4 py-12 grid grid-cols-1 md:grid-cols-3 gap-8">
        <div>
          <div className="font-display text-white text-xl font-bold mb-2">{school.name}</div>
          <p className="text-sm leading-relaxed">{school.address}</p>
          <p className="text-sm mt-1">{school.phone}</p>
          <p className="text-sm">{school.email}</p>
        </div>

        <div>
          <h3 className="text-white font-semibold mb-3">Quick Links</h3>
          <ul className="space-y-2">
            {navigation.map((item) => (
              <li key={item.href}>
                <Link to={item.href} className="text-sm hover:text-white transition-colors">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="text-white font-semibold mb-3">Office Hours</h3>
          <p className="text-sm">Monday – Friday: 8:00 AM – 4:30 PM</p>
          <p className="text-sm">Saturday: 9:00 AM – 12:00 PM (by appointment)</p>
          <p className="text-sm">Sunday: Closed</p>
        </div>
      </div>

      <div className="border-t border-gray-800 py-6">
        <p className="text-center text-sm text-gray-500">
          &copy; {new Date().getFullYear()} {school.name}. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
