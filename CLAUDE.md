# Admin Platform — Business Management System

## Project Overview
A full-stack admin platform for managing a digital course app business in Israel.
Built with React + TypeScript + Vite + Supabase.

## Tech Stack
- Frontend: React + TypeScript + Vite + Tailwind CSS
- Database: Supabase (PostgreSQL)
- Auth: Supabase Auth (email + password + 2FA)
- Automation: n8n (self-hosted on Railway)
- Payments: Cardcom
- WhatsApp: Green API
- Tasks: ClickUp
- Meetings: Calendly
- Deployment: Vercel

## Core Modules
1. Dashboard — alerts, stats, recent activity, agents status
2. Clients CRM — client cards, billing history, WhatsApp log, support tickets
3. Billing — fixed (WooCommerce) + variable (OTP + users via Cardcom)
4. WhatsApp — bulk send, templates, segmentation, media, scheduling
5. Leads CRM — Kanban, follow-up, warming sequence builder
6. Agents — n8n automation agents control panel + flow map
7. Permissions — user roles and granular access control

## Business Logic
- Packages: Solo Pro (₪140/mo), Master Class (₪235/mo), Community Master (₪370/mo)
- Variable billing: ₪1 per OTP sent + ₪100 per 250 users above threshold
- Each client can have custom OTP price, user threshold, and block price
- Billing agents run on: 1st (collect), 15th/20th/25th (follow-up), 1st (audit)
- Renewal alerts at month 11 and 12 of subscription

## Language
- UI language: Hebrew (RTL)
- Code language: English
- Comments: English

## Important Notes
- Always use RTL layout (dir="rtl")
- Use Supabase Row Level Security for all tables
- All amounts in Israeli Shekels (₪)
- Phone numbers in Israeli format
