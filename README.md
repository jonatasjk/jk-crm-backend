# JK CRM - Backend

<p align="center">
  <img src="docs/images/chief-delivery-officer.png" alt="Chief Delivery Officer" width="160" />
</p>

RESTful API backend for a CRM platform that manages investors and partners, sends transactional and sequence emails via [Resend](https://resend.com), handles file materials in local directory, and processes Resend webhook events.

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 (ESM) |
| Framework | Fastify 5 |
| Language | TypeScript |
| Database | MongoDB via Mongoose |
| Email | Resend |
| File storage | Local directory |
| Auth | JWT (`@fastify/jwt`) |
| Validation | Zod |
| Container | Docker (multi-stage) |

## Project Structure

```
src/
  app.ts              # Fastify application factory
  server.ts           # Entry point
  config/             # env, db, AWS, Prisma config
  controllers/        # Route handlers
  middleware/         # JWT auth middleware
  models/             # Mongoose models
  routes/             # Route registration (prefix /api/v1)
  schemas/            # Zod validation schemas
  services/           # Business logic & email scheduler
  types/              # Shared enums
```

## Getting Started

### Prerequisites

- Node.js ≥ 20
- MongoDB instance
- Resend account + webhook secret

### Environment Variables

Copy `.env.example` to `.env` and fill in all values:

```env
MONGODB_URI=mongodb://localhost:27017/crm
JWT_SECRET=<at-least-32-char-secret>
JWT_EXPIRES_IN=8h
RESEND_API_KEY=re_...
RESEND_WEBHOOK_SECRET=whsec_...
FROM_EMAIL=hello@yourdomain.com
FROM_NAME=CRM
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
```

### Install & Run

```bash
npm install

# Development (watch mode)
npm run dev

# Production build
npm run build
npm start
```

### Docker

```bash
docker build -t crm-backend .
docker run -p 3001:3001 --env-file .env crm-backend
```

## API Reference

All routes below are prefixed with `/api/v1`. Routes marked 🔒 require a `Bearer` JWT token.

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | — | Create a new user account |
| POST | `/auth/login` | — | Obtain a JWT token |
| GET | `/auth/me` | 🔒 | Current user profile |
| POST | `/auth/change-password` | 🔒 | Change password |
| POST | `/auth/forgot-password` | — | Request password-reset email |
| POST | `/auth/reset-password` | — | Complete password reset |

### Investors

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/investors` | 🔒 | List all investors |
| GET | `/investors/:id` | 🔒 | Get investor by ID |
| POST | `/investors` | 🔒 | Create investor |
| PUT | `/investors/:id` | 🔒 | Update investor |
| DELETE | `/investors/:id` | 🔒 | Delete investor |
| POST | `/investors/import` | 🔒 | Bulk import from CSV |

### Partners

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/partners` | 🔒 | List all partners |
| GET | `/partners/:id` | 🔒 | Get partner by ID |
| POST | `/partners` | 🔒 | Create partner |
| PUT | `/partners/:id` | 🔒 | Update partner |
| DELETE | `/partners/:id` | 🔒 | Delete partner |
| POST | `/partners/import` | 🔒 | Bulk import from CSV |

### Email

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/email/send` | 🔒 | Send a transactional email |
| GET | `/email/stats` | 🔒 | Daily send stats |
| GET | `/email/logs` | 🔒 | All email logs |
| GET | `/email/logs/:entityType/:entityId` | 🔒 | Logs for a specific entity |

> **Daily limit:** the system enforces a maximum of **100 sent emails per calendar day** across both individual sends and sequence steps.

### Materials

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/materials/upload` | 🔒 | Upload a file to a specific local directory (max 25 MB) |
| GET | `/materials` | 🔒 | List materials |
| GET | `/materials/:id/download` | 🔒 | Generate a download URL |
| DELETE | `/materials/:id` | 🔒 | Delete material |

### Email Sequences

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/sequences` | 🔒 | List sequences |
| GET | `/sequences/:id` | 🔒 | Get sequence |
| POST | `/sequences` | 🔒 | Create sequence |
| PUT | `/sequences/:id` | 🔒 | Update sequence |
| DELETE | `/sequences/:id` | 🔒 | Delete sequence |
| GET | `/sequences/:id/enrollments` | 🔒 | List enrollments |
| POST | `/sequences/:id/enroll` | 🔒 | Enroll a contact |
| POST | `/sequences/:id/enroll-all` | 🔒 | Enroll all contacts |
| POST | `/enrollments/:enrollmentId/unenroll` | 🔒 | Unenroll a contact |
| POST | `/enrollments/:enrollmentId/replied` | 🔒 | Mark contact as replied |

### Webhooks (public)

| Method | Path | Description |
|---|---|---|
| POST | `/webhooks/resend` | Receives Resend delivery events (signature-verified via Svix/HMAC-SHA256) |

## Sequence Scheduler

A built-in scheduler fires every minute and processes one enrollment per tick. It respects the 100 emails/day cap shared with individual sends. Email delivery status is updated automatically via the Resend webhook.

## License

MIT — see [LICENSE](LICENSE).