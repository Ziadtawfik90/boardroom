import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X, Phone } from 'lucide-react';
import { school, navigation } from '../content/siteContent';

export default function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  return (
    <header className="bg-white border-b border-gray-100 sticky top-0 z-50">
      {/* Top bar */}
      <div className="bg-emerald-800 text-white text-sm py-2">
        <div className="max-w-7xl mx-auto px-4 flex justify-between items-center">
          <span>{school.address}</span>
          <a href={`tel:${school.phone}`} className="flex items-center gap-1 hover:text-emerald-200">
            <Phone size={14} /> {school.phone}
          </a>
        </div>
      </div>

      {/* Main nav */}
      <div className="max-w-7xl mx-auto px-4 flex items-center justify-between h-16">
        <Link to="/" className="flex items-center gap-2">
          <div className="w-10 h-10 bg-emerald-700 rounded-lg flex items-center justify-center text-white font-bold text-lg font-display">
            CA
          </div>
          <div>
            <div className="font-display font-bold text-emerald-900 text-lg leading-tight">{school.name}</div>
          </div>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1">
          {navigation.map((item) => (
            <Link
              key={item.href}
              to={item.href}
              className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                location.pathname === item.href
                  ? 'bg-emerald-50 text-emerald-800'
                  : 'text-gray-600 hover:text-emerald-700 hover:bg-gray-50'
              }`}
            >
              {item.label}
            </Link>
          ))}
          <Link
            to="/admissions"
            className="ml-2 px-4 py-2 bg-emerald-700 text-white text-sm font-medium rounded-lg hover:bg-emerald-800 transition-colors"
          >
            Apply Now
          </Link>
        </nav>

        {/* Mobile toggle */}
        <button
          className="md:hidden p-2 text-gray-600"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile nav */}
      {mobileOpen && (
        <nav className="md:hidden border-t border-gray-100 bg-white pb-4">
          {navigation.map((item) => (
            <Link
              key={item.href}
              to={item.href}
              onClick={() => setMobileOpen(false)}
              className={`block px-4 py-3 text-sm font-medium ${
                location.pathname === item.href ? 'text-emerald-800 bg-emerald-50' : 'text-gray-600'
              }`}
            >
              {item.label}
            </Link>
          ))}
          <div className="px-4 pt-2">
            <Link
              to="/admissions"
              onClick={() => setMobileOpen(false)}
              className="block text-center px-4 py-2 bg-emerald-700 text-white text-sm font-medium rounded-lg"
            >
              Apply Now
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
