/**
 * Site content — editable by non-technical staff.
 * In a future iteration this can be backed by a headless CMS;
 * for now a single TypeScript file keeps things simple and type-safe.
 */

export const school = {
  name: 'Crestwood Academy',
  tagline: 'Excellence in Education Since 1987',
  phone: '(555) 234-5678',
  email: 'admissions@crestwoodacademy.edu',
  address: '1200 Oak Hill Drive, Maplewood, NJ 07040',
};

export const navigation = [
  { label: 'Home', href: '/' },
  { label: 'About', href: '/about' },
  { label: 'Academics', href: '/academics' },
  { label: 'Admissions', href: '/admissions' },
  { label: 'FAQ', href: '/faq' },
  { label: 'Contact', href: '/contact' },
];

export const heroContent = {
  headline: 'Where Every Student Discovers Their Potential',
  subheadline:
    'Crestwood Academy provides a nurturing, rigorous academic environment that prepares students for college and beyond.',
  ctaText: 'Apply Now',
  ctaHref: '/admissions',
  secondaryCtaText: 'Schedule a Visit',
  secondaryCtaHref: '/contact',
};

export const highlights = [
  {
    title: 'Small Class Sizes',
    description: 'Average 15 students per class with a 8:1 student-to-teacher ratio.',
    icon: 'Users',
  },
  {
    title: 'College Prep',
    description: '98% of graduates admitted to their top-choice university.',
    icon: 'GraduationCap',
  },
  {
    title: 'Enrichment Programs',
    description: '40+ clubs, athletics, arts, and community service opportunities.',
    icon: 'Palette',
  },
  {
    title: 'Safe Campus',
    description: 'Secure, modern facilities on a beautiful 25-acre wooded campus.',
    icon: 'Shield',
  },
];

export const aboutContent = {
  mission:
    'Crestwood Academy is dedicated to developing well-rounded individuals who excel academically, think critically, and contribute meaningfully to their communities. We believe every child deserves an education that challenges, inspires, and prepares them for a life of purpose.',
  vision:
    'To be the region\'s most trusted private school, known for academic excellence, character development, and a community where every family feels they belong.',
  values: [
    { name: 'Academic Excellence', description: 'We set high standards and give students the support to meet them.' },
    { name: 'Integrity', description: 'We teach honesty, responsibility, and ethical decision-making.' },
    { name: 'Community', description: 'We build a welcoming environment where diversity is celebrated.' },
    { name: 'Innovation', description: 'We embrace modern teaching methods and technology in the classroom.' },
  ],
  history:
    'Founded in 1987 by Dr. Margaret Crestwood, the academy began with 45 students and a vision to create a school that balanced rigorous academics with whole-child development. Today we serve over 600 students across grades Pre-K through 12, maintaining the intimate, family-centered culture our founder envisioned.',
};

export const academicsContent = {
  intro:
    'Our curriculum blends college-preparatory rigor with hands-on, project-based learning. Students develop critical thinking, creativity, and collaboration skills across every grade level.',
  divisions: [
    {
      name: 'Lower School (Pre-K – 5)',
      description:
        'A nurturing environment where curiosity drives learning. Core subjects are enriched with Spanish, art, music, and STEM exploration.',
      highlights: ['Phonics-based literacy program', 'Hands-on science labs', 'Daily outdoor play and movement'],
    },
    {
      name: 'Middle School (6 – 8)',
      description:
        'Students build independence and academic confidence through interdisciplinary projects, advisory groups, and leadership opportunities.',
      highlights: ['Honors tracks in math and science', 'Robotics and coding electives', 'Annual community service project'],
    },
    {
      name: 'Upper School (9 – 12)',
      description:
        'A challenging college-preparatory program featuring 18 AP courses, independent study options, and a senior capstone thesis.',
      highlights: ['18 AP courses offered', 'College counseling from junior year', '100% college acceptance rate'],
    },
  ],
};

export const admissionsContent = {
  intro:
    'We welcome families who share our commitment to academic excellence and character development. Our admissions process is designed to be straightforward and supportive.',
  steps: [
    { step: 1, title: 'Submit an Inquiry', description: 'Fill out our online inquiry form to receive information about Crestwood Academy.' },
    { step: 2, title: 'Schedule a Tour', description: 'Visit our campus, meet faculty, and see our classrooms in action.' },
    { step: 3, title: 'Complete the Application', description: 'Submit the online application with required documents and the application fee.' },
    { step: 4, title: 'Interview & Assessment', description: 'Students participate in a grade-appropriate assessment and family interview.' },
    { step: 5, title: 'Receive Decision', description: 'Admissions decisions are communicated within 2-3 weeks of completing the process.' },
  ],
  tuitionNote:
    'Tuition varies by grade level. Need-based financial aid is available — over 30% of our families receive assistance. Contact our admissions office for details.',
};

export const faqContent = [
  {
    question: 'What grades does Crestwood Academy serve?',
    answer: 'We enroll students from Pre-Kindergarten through 12th grade.',
  },
  {
    question: 'What is the application deadline?',
    answer:
      'Our priority deadline is January 15 for the following school year. We accept rolling admissions after that date based on available space.',
  },
  {
    question: 'Do you offer financial aid?',
    answer:
      'Yes. Over 30% of our families receive need-based financial assistance. We are committed to making a Crestwood education accessible.',
  },
  {
    question: 'What is the student-to-teacher ratio?',
    answer: 'Our average class size is 15 students, with an overall 8:1 student-to-teacher ratio.',
  },
  {
    question: 'Is transportation provided?',
    answer:
      'We offer bus service on select routes. Families can also arrange carpools through our parent portal.',
  },
  {
    question: 'What extracurricular activities are available?',
    answer:
      'We offer over 40 clubs and activities including athletics (12 varsity sports), performing arts, debate, robotics, Model UN, and community service programs.',
  },
  {
    question: 'How do I schedule a campus tour?',
    answer:
      'You can request a tour through our Contact page or by calling the admissions office at (555) 234-5678.',
  },
];

export const contactContent = {
  intro: 'We would love to hear from you. Reach out to learn more about Crestwood Academy or to schedule a visit.',
  departments: [
    { name: 'Admissions Office', email: 'admissions@crestwoodacademy.edu', phone: '(555) 234-5678' },
    { name: 'Main Office', email: 'info@crestwoodacademy.edu', phone: '(555) 234-5600' },
    { name: 'Athletics', email: 'athletics@crestwoodacademy.edu', phone: '(555) 234-5690' },
  ],
};
