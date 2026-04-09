"use client";

import { useState } from "react";

interface FormData {
  // Student info
  studentFirstName: string;
  studentLastName: string;
  dateOfBirth: string;
  currentGrade: string;
  applyingForGrade: string;
  currentSchool: string;
  // Parent info
  parentFirstName: string;
  parentLastName: string;
  parentEmail: string;
  parentPhone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  // Additional
  howDidYouHear: string;
  whyInterested: string;
  specialNeeds: string;
  agreeTerms: boolean;
}

const initialFormData: FormData = {
  studentFirstName: "",
  studentLastName: "",
  dateOfBirth: "",
  currentGrade: "",
  applyingForGrade: "",
  currentSchool: "",
  parentFirstName: "",
  parentLastName: "",
  parentEmail: "",
  parentPhone: "",
  address: "",
  city: "",
  state: "",
  zip: "",
  howDidYouHear: "",
  whyInterested: "",
  specialNeeds: "",
  agreeTerms: false,
};

const GRADE_OPTIONS = [
  "Kindergarten",
  "1st Grade",
  "2nd Grade",
  "3rd Grade",
  "4th Grade",
  "5th Grade",
  "6th Grade",
  "7th Grade",
  "8th Grade",
  "9th Grade",
  "10th Grade",
  "11th Grade",
  "12th Grade",
];

export default function Admissions() {
  const [step, setStep] = useState(0); // 0 = info page, 1-3 = form steps, 4 = success
  const [form, setForm] = useState<FormData>(initialFormData);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const update = (field: keyof FormData, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Submission failed");
      setStep(4);
    } catch {
      setError("Something went wrong. Please try again or contact admissions@crestwood.edu.");
    } finally {
      setSubmitting(false);
    }
  };

  // Info page before form
  if (step === 0) {
    return (
      <>
        <section className="hero" style={{ padding: "60px 0 80px" }}>
          <div className="container">
            <h1>Admissions</h1>
            <p>Join the Crestwood Academy community. Applications for 2026-2027 are open.</p>
          </div>
        </section>

        <section className="section">
          <div className="container" style={{ maxWidth: 800 }}>
            <h2 className="section-title">How to Apply</h2>
            <div className="card-grid" style={{ gridTemplateColumns: "1fr", gap: 24, marginTop: 32 }}>
              <div className="card">
                <h3>Step 1: Submit Online Application</h3>
                <p>Complete the online application form below. It takes approximately 10-15 minutes.</p>
              </div>
              <div className="card">
                <h3>Step 2: Campus Visit & Interview</h3>
                <p>After reviewing your application, our admissions team will contact you to schedule a campus tour and family interview.</p>
              </div>
              <div className="card">
                <h3>Step 3: Submit Records</h3>
                <p>Provide transcripts, teacher recommendations, and any standardized test scores. We&apos;ll guide you through what&apos;s needed.</p>
              </div>
              <div className="card">
                <h3>Step 4: Admissions Decision</h3>
                <p>Decisions are communicated within 2-3 weeks of completing all steps. Financial aid decisions accompany acceptance letters.</p>
              </div>
            </div>

            <div style={{ marginTop: 48 }}>
              <h2 className="section-title">Tuition & Financial Aid</h2>
              <p className="section-subtitle">We are committed to making Crestwood accessible to qualified families</p>
              <div className="card-grid" style={{ marginTop: 16 }}>
                <div className="card" style={{ textAlign: "center" }}>
                  <h3>Lower School (K-5)</h3>
                  <div className="stat-number" style={{ fontSize: "1.8rem" }}>$18,500</div>
                  <p>per year</p>
                </div>
                <div className="card" style={{ textAlign: "center" }}>
                  <h3>Middle School (6-8)</h3>
                  <div className="stat-number" style={{ fontSize: "1.8rem" }}>$22,000</div>
                  <p>per year</p>
                </div>
                <div className="card" style={{ textAlign: "center" }}>
                  <h3>Upper School (9-12)</h3>
                  <div className="stat-number" style={{ fontSize: "1.8rem" }}>$26,500</div>
                  <p>per year</p>
                </div>
              </div>
              <p style={{ textAlign: "center", marginTop: 24, color: "var(--text-light)" }}>
                Over 35% of our families receive need-based financial aid. Aid decisions are need-blind for admissions.
              </p>
            </div>

            <div style={{ textAlign: "center", marginTop: 48 }}>
              <button className="btn" onClick={() => setStep(1)} style={{ padding: "16px 48px", fontSize: "1.1rem" }}>
                Start Your Application
              </button>
            </div>
          </div>
        </section>
      </>
    );
  }

  // Success page
  if (step === 4) {
    return (
      <section className="section">
        <div className="container">
          <div className="form-success">
            <div style={{ fontSize: "3rem", marginBottom: 16 }}>&#10003;</div>
            <h2>Application Submitted Successfully</h2>
            <p style={{ color: "var(--text-light)", maxWidth: 500, margin: "16px auto 0" }}>
              Thank you for applying to Crestwood Academy. Our admissions team will review your
              application and contact you within 5 business days to discuss next steps.
            </p>
            <p style={{ marginTop: 24 }}>
              <strong>Confirmation has been sent to {form.parentEmail}</strong>
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="section">
      <div className="container">
        <div className="form-section">
          <h2 className="section-title">Online Application</h2>
          <p className="section-subtitle">2026-2027 Academic Year</p>

          {/* Step indicator */}
          <div className="step-indicator">
            <div className={`step-dot ${step >= 1 ? (step > 1 ? "done" : "active") : ""}`}>1</div>
            <div className="step-line" />
            <div className={`step-dot ${step >= 2 ? (step > 2 ? "done" : "active") : ""}`}>2</div>
            <div className="step-line" />
            <div className={`step-dot ${step >= 3 ? "active" : ""}`}>3</div>
          </div>

          {/* Step 1: Student Info */}
          {step === 1 && (
            <div>
              <h3 style={{ marginBottom: 24, color: "var(--primary)" }}>Student Information</h3>
              <div className="form-row">
                <div className="form-group">
                  <label>First Name *</label>
                  <input value={form.studentFirstName} onChange={(e) => update("studentFirstName", e.target.value)} required />
                </div>
                <div className="form-group">
                  <label>Last Name *</label>
                  <input value={form.studentLastName} onChange={(e) => update("studentLastName", e.target.value)} required />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Date of Birth *</label>
                  <input type="date" value={form.dateOfBirth} onChange={(e) => update("dateOfBirth", e.target.value)} required />
                </div>
                <div className="form-group">
                  <label>Current Grade</label>
                  <select value={form.currentGrade} onChange={(e) => update("currentGrade", e.target.value)}>
                    <option value="">Select...</option>
                    <option value="Pre-K">Pre-K</option>
                    {GRADE_OPTIONS.map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Applying for Grade *</label>
                  <select value={form.applyingForGrade} onChange={(e) => update("applyingForGrade", e.target.value)} required>
                    <option value="">Select...</option>
                    {GRADE_OPTIONS.map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Current School</label>
                  <input value={form.currentSchool} onChange={(e) => update("currentSchool", e.target.value)} />
                </div>
              </div>
              <div className="btn-row">
                <button className="btn btn-secondary" onClick={() => setStep(0)}>Back</button>
                <button
                  className="btn"
                  disabled={!form.studentFirstName || !form.studentLastName || !form.dateOfBirth || !form.applyingForGrade}
                  onClick={() => setStep(2)}
                >
                  Next: Parent Info
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Parent Info */}
          {step === 2 && (
            <div>
              <h3 style={{ marginBottom: 24, color: "var(--primary)" }}>Parent / Guardian Information</h3>
              <div className="form-row">
                <div className="form-group">
                  <label>First Name *</label>
                  <input value={form.parentFirstName} onChange={(e) => update("parentFirstName", e.target.value)} required />
                </div>
                <div className="form-group">
                  <label>Last Name *</label>
                  <input value={form.parentLastName} onChange={(e) => update("parentLastName", e.target.value)} required />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Email Address *</label>
                  <input type="email" value={form.parentEmail} onChange={(e) => update("parentEmail", e.target.value)} required />
                </div>
                <div className="form-group">
                  <label>Phone Number *</label>
                  <input type="tel" value={form.parentPhone} onChange={(e) => update("parentPhone", e.target.value)} required />
                </div>
              </div>
              <div className="form-group">
                <label>Street Address *</label>
                <input value={form.address} onChange={(e) => update("address", e.target.value)} required />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>City *</label>
                  <input value={form.city} onChange={(e) => update("city", e.target.value)} required />
                </div>
                <div className="form-group" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div>
                    <label>State *</label>
                    <input value={form.state} onChange={(e) => update("state", e.target.value)} required />
                  </div>
                  <div>
                    <label>ZIP *</label>
                    <input value={form.zip} onChange={(e) => update("zip", e.target.value)} required />
                  </div>
                </div>
              </div>
              <div className="btn-row">
                <button className="btn btn-secondary" onClick={() => setStep(1)}>Back</button>
                <button
                  className="btn"
                  disabled={!form.parentFirstName || !form.parentLastName || !form.parentEmail || !form.parentPhone}
                  onClick={() => setStep(3)}
                >
                  Next: Additional Info
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Additional Info + Submit */}
          {step === 3 && (
            <div>
              <h3 style={{ marginBottom: 24, color: "var(--primary)" }}>Additional Information</h3>
              <div className="form-group">
                <label>How did you hear about Crestwood Academy?</label>
                <select value={form.howDidYouHear} onChange={(e) => update("howDidYouHear", e.target.value)}>
                  <option value="">Select...</option>
                  <option>Friend or Family Referral</option>
                  <option>School Fair or Event</option>
                  <option>Online Search</option>
                  <option>Social Media</option>
                  <option>News or Publication</option>
                  <option>Other</option>
                </select>
              </div>
              <div className="form-group">
                <label>Why are you interested in Crestwood Academy? *</label>
                <textarea
                  rows={4}
                  value={form.whyInterested}
                  onChange={(e) => update("whyInterested", e.target.value)}
                  placeholder="Tell us what draws your family to Crestwood..."
                  required
                />
              </div>
              <div className="form-group">
                <label>Does your child have any learning differences or special needs we should be aware of?</label>
                <textarea
                  rows={3}
                  value={form.specialNeeds}
                  onChange={(e) => update("specialNeeds", e.target.value)}
                  placeholder="Optional — this information is kept confidential and does not affect admissions decisions."
                />
              </div>
              <div className="form-group">
                <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={form.agreeTerms}
                    onChange={(e) => update("agreeTerms", e.target.checked)}
                    style={{ width: "auto" }}
                  />
                  I certify that the information provided is accurate and complete. I understand this is an
                  inquiry application and additional documentation may be required. *
                </label>
              </div>

              {error && (
                <p style={{ color: "var(--error)", marginBottom: 16 }}>{error}</p>
              )}

              <div className="btn-row">
                <button className="btn btn-secondary" onClick={() => setStep(2)}>Back</button>
                <button
                  className="btn"
                  disabled={!form.whyInterested || !form.agreeTerms || submitting}
                  onClick={handleSubmit}
                >
                  {submitting ? "Submitting..." : "Submit Application"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
