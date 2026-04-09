# Portfolio Website - MVP Definition

**Status:** Approved (consent agenda)
**Owner:** ASUS (The Builder)
**Date:** 2026-04-09

---

## Pages

### 1. Home (`/`)
The landing page. First impression, sets the tone.

**Content structure:**
```
- Hero section
  - Name / title
  - Tagline (1-2 sentences)
  - Call-to-action button -> Projects or Contact
- Featured projects (3 max, cards linking to /projects/:slug)
  - Thumbnail image
  - Title
  - Short description (1 line)
  - Tech tags
- Brief intro paragraph (2-3 sentences, links to /about)
```

### 2. About (`/about`)
Who this person is, what they do, what they care about.

**Content structure:**
```
- Profile photo
- Bio (2-3 paragraphs)
- Skills / technologies
  - Category (e.g., Frontend, Backend, DevOps)
  - List of technologies per category
- Experience timeline (optional for MVP, can be static)
  - Role, company, date range, 1-line description
- Downloadable resume link (PDF asset)
```

### 3. Projects (`/projects`)
Grid/list of portfolio pieces. This is the core of the site.

**Content structure:**
```
- Project list (filterable by tag in v2, static for MVP)
- Each project card:
  - Thumbnail image
  - Title
  - Short description (1-2 sentences)
  - Tech tags
  - Link to detail page
```

### 4. Project Detail (`/projects/:slug`)
Deep dive into a single project.

**Content structure:**
```
- Title
- Hero image / screenshot
- Description (rich text, multiple paragraphs)
- Tech stack used (tags)
- Role / contribution
- Links
  - Live URL (optional)
  - Source code URL (optional)
- Image gallery (2-4 additional screenshots)
- Next/previous project navigation
```

### 5. Contact (`/contact`)
Simple way to get in touch.

**Content structure:**
```
- Heading + short intro text
- Contact form
  - Name (required)
  - Email (required)
  - Message (required, textarea)
  - Submit button
- Social links
  - GitHub
  - LinkedIn
  - Email (mailto)
  - Twitter/X (optional)
```

---

## Data Schema (API Contract for WATER)

This is the shared contract. WATER builds the API to serve this. ASUS consumes it.

### `Project`
```typescript
interface Project {
  id: string;
  slug: string;             // URL-safe identifier
  title: string;
  shortDescription: string; // max 160 chars, used in cards
  description: string;      // rich text / markdown, used in detail
  thumbnailUrl: string;
  images: string[];          // gallery URLs
  techStack: string[];
  role: string;
  liveUrl?: string;
  sourceUrl?: string;
  featured: boolean;        // shown on home page
  order: number;            // sort order
  createdAt: string;        // ISO 8601
}
```

### `ContactSubmission`
```typescript
interface ContactSubmission {
  id: string;
  name: string;
  email: string;
  message: string;
  submittedAt: string;      // ISO 8601
}
```

### `SiteConfig`
```typescript
interface SiteConfig {
  name: string;
  title: string;
  tagline: string;
  bio: string;              // markdown
  profileImageUrl: string;
  resumeUrl: string;
  skills: {
    category: string;
    items: string[];
  }[];
  experience: {
    role: string;
    company: string;
    startDate: string;
    endDate?: string;
    description: string;
  }[];
  socialLinks: {
    platform: string;       // github | linkedin | email | twitter
    url: string;
  }[];
}
```

---

## API Endpoints (Proposed for WATER)

| Method | Endpoint               | Description                |
|--------|------------------------|----------------------------|
| GET    | `/api/projects`        | List all projects          |
| GET    | `/api/projects/:slug`  | Get single project         |
| GET    | `/api/config`          | Get site config            |
| POST   | `/api/contact`         | Submit contact form        |

---

## Scope Boundaries (What is NOT in MVP)

- Blog / articles section
- CMS admin panel (content is seeded/static for MVP)
- Authentication
- Analytics dashboard
- Dark/light theme toggle (pick one, ship it)
- Project filtering/search
- Animations beyond basic transitions
- i18n / multi-language support
- Comments or testimonials section

---

## Tech Decisions

| Concern          | Decision                              | Owner |
|------------------|---------------------------------------|-------|
| Framework        | Next.js (App Router)                  | ASUS  |
| Styling          | Tailwind CSS                          | ASUS  |
| API              | Next.js API routes or standalone      | WATER |
| Data storage     | JSON files or SQLite for MVP          | WATER |
| Deployment       | Vercel                                | ASUS  |
| CI/CD            | GitHub Actions                        | STEAM |
| Testing          | Playwright (e2e) + Vitest (unit)      | STEAM |

---

## Dependencies Between Agents

```
WATER: Define data schema  -->  WATER: Build API  -->  ASUS: Integrate API
                                                   -->  STEAM: Write API tests

ASUS: Scaffold frontend    -->  ASUS: Build pages  -->  STEAM: Write e2e tests
                                                   -->  STEAM: Visual regression

STEAM: Set up CI/CD (can start immediately, no blockers)
```

ASUS can scaffold the frontend and build static layouts immediately using mock data. WATER's API only blocks final integration, not initial development.
