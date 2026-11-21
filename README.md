<div align="center">

# 🎓 Coolage

### Every school. One platform. All connected.

A multi-school management platform that brings students, teachers, and school administrators into one connected workspace.

**[🌐 Visit the Live App](https://coolage.namanchhabracontact.workers.dev/)**

**YIIC9 Educational Project · Prototype / MVP**

</div>

---

## 💡 The Problem

Schools often rely on separate apps or disconnected systems for students and staff. That makes everyday tasks—sharing homework, tracking attendance, managing accounts, and posting announcements—more complicated than necessary.

**Coolage** explores a single platform that multiple schools can use while keeping each school's accounts and records separate.

## Features

| Student | Teacher / Staff | School Admin |
| --- | --- | --- |
| Sign in with a school code and student ID | Sign in with school-issued credentials | Manage school accounts |
| View assigned homework | Create homework for assigned classes | Create teacher accounts |
| Read school and class announcements | Post announcements | Manage student and staff details |
| View personal attendance | Mark attendance for assigned students | Oversee school-level records |

Additional capabilities:

- **Multi-school architecture:** School-specific users and records, with role and school checks in the API.
- **School registration:** A school representative can create a school and administrator account.
- **Credential-based access:** Students and staff use school-issued login IDs and passwords.
- **Demo mode:** Explore fictional sample data without creating a real school account.
- **Responsive interface:** A browser-based frontend designed for desktop and mobile use.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | HTML, CSS, vanilla JavaScript |
| Backend | Cloudflare Workers |
| Database | Cloudflare D1 (SQLite) |
| Deployment | Cloudflare Workers Static Assets |
| Development & testing | Node.js, Wrangler, Node.js test runner |

## Architecture

```text
Browser (Student / Staff / Admin)
            |
            v
Cloudflare Worker
  |-- Static frontend (public/)
  |-- API routes (src/index.js)
            |
            v
Cloudflare D1 database
  |-- Schools and school requests
  |-- Users, staff classes, sessions
  |-- Homework and announcements
  |-- Attendance
```

Each API request is checked against the authenticated user's role and school context. Teachers are restricted to their assigned classes for relevant operations.

## Project Structure

```text
coolage/
├── public/                 # Frontend HTML, CSS, JavaScript
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   └── config.js
├── src/
│   └── index.js            # Cloudflare Worker and API routes
├── migrations/             # D1 database schema and updates
├── scripts/
│   └── create-school.mjs   # Optional school onboarding utility
├── tests/
│   └── api.test.mjs        # API tests
├── wrangler.toml           # Cloudflare Worker configuration
├── package.json
└── .gitignore
```

## Run Locally

**Requirements:** Node.js 22 or later and npm.

1. Clone this repository and open its folder.
2. Install dependencies:

   ```bash
   npm ci
   ```

3. In `public/config.js`, set `apiBaseUrl` to an empty string (`""`) so the local frontend uses the local API.
4. Initialize the local D1 database:

   ```bash
   npm run migrate:local
   ```

5. Start the development server:

   ```bash
   npm run dev
   ```

Open the local URL displayed by Wrangler (typically `http://localhost:8787`). You can also explore the built-in demo using fictional data.

## Deploy to Cloudflare

1. Sign in to Cloudflare through Wrangler (`npx wrangler login`).
2. Create a D1 database named `coolage-db`, or use a database you control.
3. Update the `database_id` in `wrangler.toml` with your own D1 database ID.
4. Keep `public/config.js` set to `apiBaseUrl: ""` when frontend and API are hosted together.
5. Apply the migrations and deploy:

   ```bash
   npm run migrate:remote
   npm run deploy
   ```

> **Note:** Remote migrations modify the configured Cloudflare database. Review them and back up any important data before applying them. Do not commit Cloudflare credentials or secrets.

## Testing

Run the automated API tests:

```bash
npm test
```

**Current source snapshot:** 30 API tests passing. They cover authentication, school-scoped access, teacher permissions, homework, attendance, school registration, and administrative account management.

These tests do **not** constitute a complete production security audit.

## Privacy & Current Limitations

Coolage is an **educational MVP**, not a production-certified school information system.

- Do not enter real student records or other sensitive school data without proper authorization and a privacy/security review.
- School registration is currently self-service; **school ownership is not independently verified**. Verification and approval controls are needed before real-world onboarding.
- Authentication, access control, privacy, reliability, and abuse prevention require further production testing.
- Keep API tokens, `.env` files, `.dev.vars`, database exports, and real credentials out of GitHub.
- The app does **not** currently include a deployed AI-generation feature.

## Future Improvements

- Verified school onboarding and administrator approval
- Stronger account recovery and security controls
- More detailed academic reporting and timetable tools
- Accessibility and mobile usability improvements
- Feedback-driven refinements from real, authorized testers

## Project Context

**Coolage was developed as part of YIIC9 (Young Innovators Internship Challenge).** It is an educational challenge submission and **is not included in my professional software-development portfolio**. It should not be used to judge my independent engineering skills or usual development workflow.

---

<div align="center">
  <sub>Coolage · Built for YIIC9</sub>
</div>
