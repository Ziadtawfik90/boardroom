# Crestwood Academy — Deployment Guide

## Quick Deploy to Vercel

1. **Install Vercel CLI** (if not already):
   ```bash
   npm i -g vercel@latest
   ```

2. **Link project** (first time only):
   ```bash
   cd packages/school-website
   vercel link
   ```

3. **Deploy to preview**:
   ```bash
   vercel deploy
   ```

4. **Deploy to production**:
   ```bash
   vercel deploy --prod
   ```

## Custom Domain Setup

1. Go to Vercel Dashboard → Project Settings → Domains
2. Add your domain (e.g., `www.crestwoodacademy.edu`)
3. Update DNS records as instructed by Vercel:
   - **A Record**: `76.76.21.21`
   - **CNAME**: `cname.vercel-dns.com` (for `www` subdomain)
4. SSL/TLS certificates are provisioned automatically by Vercel

## Production Checklist

- [ ] Replace in-memory application store with Neon Postgres (via Vercel Marketplace: `vercel integration add neon`)
- [ ] Add authentication to the `GET /api/applications` endpoint
- [ ] Configure email notifications for new applications (e.g., Resend via Marketplace)
- [ ] Update contact form action URL (currently placeholder)
- [ ] Add real school photos and content
- [ ] Set up Vercel Analytics for traffic monitoring
