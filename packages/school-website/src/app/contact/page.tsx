export default function Contact() {
  return (
    <>
      <section className="hero" style={{ padding: "60px 0 80px" }}>
        <div className="container">
          <h1>Contact Us</h1>
          <p>We&apos;d love to hear from you. Reach out to learn more or schedule a campus visit.</p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="contact-grid">
            <div className="contact-info">
              <h3>Get in Touch</h3>
              <div className="contact-item">
                <div className="contact-icon">📍</div>
                <div>
                  <strong>Campus Address</strong>
                  <p>123 Crestwood Drive, Springfield, ST 12345</p>
                </div>
              </div>
              <div className="contact-item">
                <div className="contact-icon">📞</div>
                <div>
                  <strong>Phone</strong>
                  <p>(555) 123-4567</p>
                </div>
              </div>
              <div className="contact-item">
                <div className="contact-icon">✉️</div>
                <div>
                  <strong>Email</strong>
                  <p>admissions@crestwood.edu</p>
                </div>
              </div>
              <div className="contact-item">
                <div className="contact-icon">🕐</div>
                <div>
                  <strong>Office Hours</strong>
                  <p>Monday - Friday: 8:00 AM - 4:30 PM</p>
                </div>
              </div>

              <div style={{ marginTop: 32 }}>
                <h3>Schedule a Tour</h3>
                <p style={{ color: "var(--text-light)", marginTop: 8 }}>
                  The best way to experience Crestwood Academy is to visit our campus.
                  Personal tours are available Monday through Friday during the school year.
                  Call or email our admissions office to schedule your visit.
                </p>
              </div>
            </div>

            <div className="form-section">
              <h3 style={{ marginBottom: 24, color: "var(--primary)" }}>Send a Message</h3>
              <form action="https://formspree.io/f/placeholder" method="POST">
                <div className="form-group">
                  <label htmlFor="name">Your Name</label>
                  <input type="text" id="name" name="name" required />
                </div>
                <div className="form-group">
                  <label htmlFor="email">Email Address</label>
                  <input type="email" id="email" name="email" required />
                </div>
                <div className="form-group">
                  <label htmlFor="phone">Phone Number</label>
                  <input type="tel" id="phone" name="phone" />
                </div>
                <div className="form-group">
                  <label htmlFor="subject">Subject</label>
                  <select id="subject" name="subject">
                    <option value="">Select a topic...</option>
                    <option>Admissions Inquiry</option>
                    <option>Schedule a Tour</option>
                    <option>Financial Aid</option>
                    <option>General Question</option>
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="message">Message</label>
                  <textarea id="message" name="message" rows={5} required></textarea>
                </div>
                <button type="submit" className="btn">Send Message</button>
              </form>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
