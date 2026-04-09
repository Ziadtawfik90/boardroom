export default function Academics() {
  return (
    <>
      <section className="hero" style={{ padding: "60px 0 80px" }}>
        <div className="container">
          <h1>Academics</h1>
          <p>A challenging, supportive curriculum designed to prepare students for college and life beyond.</p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2 className="section-title">Programs by Division</h2>
          <p className="section-subtitle">Age-appropriate rigor from kindergarten through 12th grade</p>
          <div className="card-grid">
            <div className="card">
              <h3>Lower School (K-5)</h3>
              <p>
                A joyful, inquiry-based program that builds strong foundations in literacy,
                mathematics, science, and the arts. Daily Spanish instruction begins in
                kindergarten. Small class sizes (max 16) ensure every child is seen and supported.
              </p>
            </div>
            <div className="card">
              <h3>Middle School (6-8)</h3>
              <p>
                Students explore their interests through a rich core curriculum and rotating
                electives in technology, visual arts, performing arts, and world languages.
                Advisory groups and a structured study skills program support the transition years.
              </p>
            </div>
            <div className="card">
              <h3>Upper School (9-12)</h3>
              <p>
                A college-preparatory program featuring 22 AP courses, independent study
                opportunities, and a senior capstone project. Students work closely with
                college counselors beginning in 10th grade.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section section-alt">
        <div className="container">
          <h2 className="section-title">Special Programs</h2>
          <div className="card-grid">
            <div className="card">
              <h3>STEAM Initiative</h3>
              <p>Integrated science, technology, engineering, arts, and mathematics programs with a dedicated innovation lab and maker space.</p>
            </div>
            <div className="card">
              <h3>Global Studies</h3>
              <p>Exchange programs with partner schools in France, Japan, and Costa Rica. Model UN, global issues seminars, and language immersion.</p>
            </div>
            <div className="card">
              <h3>Arts Conservatory</h3>
              <p>Intensive tracks in visual arts, music, theater, and dance. Annual gallery exhibitions and three major theatrical productions per year.</p>
            </div>
            <div className="card">
              <h3>Athletics</h3>
              <p>18 varsity sports, state-of-the-art facilities, and a philosophy that emphasizes teamwork, sportsmanship, and personal growth over winning at all costs.</p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
