import { NextResponse } from "next/server";

// In-memory store for MVP. In production, replace with a database
// (e.g., Neon Postgres via Vercel Marketplace).
const applications: Record<string, unknown>[] = [];

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Basic server-side validation
    const required = [
      "studentFirstName",
      "studentLastName",
      "dateOfBirth",
      "applyingForGrade",
      "parentFirstName",
      "parentLastName",
      "parentEmail",
      "parentPhone",
      "whyInterested",
    ];

    for (const field of required) {
      if (!body[field] || typeof body[field] !== "string" || body[field].trim() === "") {
        return NextResponse.json(
          { error: `Missing required field: ${field}` },
          { status: 400 }
        );
      }
    }

    if (!body.agreeTerms) {
      return NextResponse.json(
        { error: "You must agree to the terms" },
        { status: 400 }
      );
    }

    // Generate application ID
    const appId = `CW-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    const application = {
      id: appId,
      submittedAt: new Date().toISOString(),
      status: "pending_review",
      student: {
        firstName: body.studentFirstName.trim(),
        lastName: body.studentLastName.trim(),
        dateOfBirth: body.dateOfBirth,
        currentGrade: body.currentGrade || null,
        applyingForGrade: body.applyingForGrade,
        currentSchool: body.currentSchool || null,
      },
      parent: {
        firstName: body.parentFirstName.trim(),
        lastName: body.parentLastName.trim(),
        email: body.parentEmail.trim().toLowerCase(),
        phone: body.parentPhone.trim(),
        address: body.address?.trim() || null,
        city: body.city?.trim() || null,
        state: body.state?.trim() || null,
        zip: body.zip?.trim() || null,
      },
      additional: {
        howDidYouHear: body.howDidYouHear || null,
        whyInterested: body.whyInterested.trim(),
        specialNeeds: body.specialNeeds?.trim() || null,
      },
    };

    applications.push(application);

    console.log(`[APPLICATION] New application ${appId} from ${application.parent.email}`);

    return NextResponse.json({
      success: true,
      applicationId: appId,
      message: "Application submitted successfully",
    });
  } catch (err) {
    console.error("[APPLICATION] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  // In production, this endpoint should be auth-protected
  return NextResponse.json({
    total: applications.length,
    applications: [...applications].sort(
      (a, b) =>
        new Date(b.submittedAt as string).getTime() -
        new Date(a.submittedAt as string).getTime()
    ),
  });
}
