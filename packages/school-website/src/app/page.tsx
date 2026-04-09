import Link from "next/link";

export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="container">
          <h1>Where Every Student Discovers Their Potential</h1>
          <p>
            Crestwood Academy provides a rigorous, nurturing environment where
            students develop intellectually, socially, and ethically — preparing
            them for lives of purpose and leadership.
          </p>
          <Link href="/admissions" className="hero-cta">
            Begin Your Application
          </Link>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="stats">
            <div>
              <div className="stat-number">8:1</div>
              <div className="stat-label">Student-Teacher Ratio</div>
            </div>
            <div>
              <div className="stat-number">98%</div>
              <div className="stat-label">College Acceptance Rate</div>
            </div>
            <div>
              <div className="stat-number">40+</div>
              <div className="stat-label">Extracurricular Programs</div>
            </div>
            <div>
              <div className="stat-number">1985</div>
              <div className="stat-label">Established</div>
            </div>
          </div>
        </div>
      </section>

      <section className="section section-alt">
        <div className="container">
          <h2 className="section-title">Why Crestwood Academy</h2>
          <p className="section-subtitle">
            A tradition of excellence, a commitment to every child
          </p>
          <div className="card-grid">
            <div className="card">
              <h3>Rigorous Academics</h3>
              <p>
                Our curriculum challenges students to think critically, solve
                creatively, and communicate effectively. AP courses, honors
                tracks, and interdisciplinary projects prepare students for
                top-tier universities.
              </p>
            </div>
            <div className="card">
              <h3>Character Development</h3>
              <p>
                We believe education extends beyond the classroom. Our advisory
                program, community service requirements, and leadership
                opportunities build students of integrity and empathy.
              </p>
            </div>
            <div className="card">
              <h3>Small Class Sizes</h3>
              <p>
                With an 8:1 student-teacher ratio, every student receives
                individualized attention. Our teachers know each student by name
                and tailor instruction to their strengths and growth areas.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2 className="section-title">Admissions Open for 2026-2027</h2>
          <p className="section-subtitle">
            Applications are now being accepted for all grade levels. Space is
            limited.
          </p>
          <div style={{ textAlign: "center" }}>
            <Link href="/admissions" className="hero-cta">
              Apply Online Today
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
