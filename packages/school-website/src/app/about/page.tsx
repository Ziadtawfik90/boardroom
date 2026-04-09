export default function About() {
  return (
    <>
      <section className="hero" style={{ padding: "60px 0 80px" }}>
        <div className="container">
          <h1>About Crestwood Academy</h1>
          <p>Founded in 1985, we have been shaping tomorrow&apos;s leaders for nearly four decades.</p>
        </div>
      </section>

      <section className="section">
        <div className="container" style={{ maxWidth: 800 }}>
          <h2 className="section-title">Our Mission</h2>
          <p style={{ textAlign: "center", fontSize: "1.2rem", marginBottom: 48, color: "var(--text-light)" }}>
            To provide an exceptional education that develops the whole child — intellectually,
            socially, and ethically — in a diverse, inclusive community that inspires a lifelong
            love of learning and a commitment to making a positive difference in the world.
          </p>

          <h2 className="section-title">Our Values</h2>
          <div className="card-grid" style={{ marginTop: 32 }}>
            <div className="card">
              <h3>Excellence</h3>
              <p>We set high standards and provide the support every student needs to meet them. Mediocrity is never the goal — growth is.</p>
            </div>
            <div className="card">
              <h3>Integrity</h3>
              <p>Honesty, honor, and ethical conduct form the foundation of our community. We hold ourselves accountable.</p>
            </div>
            <div className="card">
              <h3>Community</h3>
              <p>We are a family. Students, parents, faculty, and alumni share a bond built on mutual respect, collaboration, and care.</p>
            </div>
            <div className="card">
              <h3>Curiosity</h3>
              <p>We celebrate questions as much as answers. Our students learn to inquire, investigate, and innovate across every discipline.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="section section-alt">
        <div className="container" style={{ maxWidth: 800 }}>
          <h2 className="section-title">Leadership</h2>
          <p className="section-subtitle">Dedicated educators guiding our community</p>
          <div className="card-grid">
            <div className="card" style={{ textAlign: "center" }}>
              <h3>Dr. Margaret Chen</h3>
              <p><strong>Head of School</strong></p>
              <p style={{ marginTop: 8 }}>Ed.D. from Harvard. 25 years in independent school education. Previously led academic programs at Phillips Academy.</p>
            </div>
            <div className="card" style={{ textAlign: "center" }}>
              <h3>James Whitfield</h3>
              <p><strong>Director of Admissions</strong></p>
              <p style={{ marginTop: 8 }}>M.Ed. from Stanford. 15 years helping families find the right educational fit. Passionate about accessible, equitable admissions.</p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
