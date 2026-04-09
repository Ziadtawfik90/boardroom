import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Crestwood Academy — Excellence in Education",
  description:
    "Crestwood Academy is a leading private school offering rigorous academics, character development, and a nurturing community for grades K-12.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header className="header">
          <div className="header-inner">
            <Link href="/" className="logo">
              <span className="logo-crest">CA</span>
              Crestwood Academy
            </Link>
            <nav>
              <Link href="/">Home</Link>
              <Link href="/about">About</Link>
              <Link href="/academics">Academics</Link>
              <Link href="/admissions">Admissions</Link>
              <Link href="/contact">Contact</Link>
              <Link href="/admissions" className="apply-btn">
                Apply Now
              </Link>
            </nav>
          </div>
        </header>
        {children}
        <footer className="footer">
          <div className="container">
            <div className="footer-grid">
              <div>
                <h4>Crestwood Academy</h4>
                <p>
                  Nurturing minds, building character, and inspiring excellence
                  since 1985. Our students go on to attend the nation&apos;s top
                  universities and become leaders in their fields.
                </p>
              </div>
              <div>
                <h4>Quick Links</h4>
                <Link href="/about">About Us</Link>
                <Link href="/academics">Academics</Link>
                <Link href="/admissions">Admissions</Link>
                <Link href="/contact">Contact</Link>
              </div>
              <div>
                <h4>Admissions</h4>
                <Link href="/admissions">Apply Online</Link>
                <Link href="/admissions">Tuition &amp; Fees</Link>
                <Link href="/admissions">Financial Aid</Link>
                <Link href="/contact">Schedule a Tour</Link>
              </div>
              <div>
                <h4>Contact</h4>
                <p>
                  123 Crestwood Drive
                  <br />
                  Springfield, ST 12345
                  <br />
                  (555) 123-4567
                  <br />
                  admissions@crestwood.edu
                </p>
              </div>
            </div>
            <div className="footer-bottom">
              &copy; {new Date().getFullYear()} Crestwood Academy. All rights
              reserved.
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
