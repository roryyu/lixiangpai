# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Dev server
npm run dev                  # Start dev server at http://localhost:3000

# Build
npm run build                # Production build (SSR)
npm run generate             # Static site generation

# Database
npx prisma migrate dev --name <name>   # Create migration from schema changes
npx prisma migrate deploy              # Apply migrations in production
npx prisma db push                     # Sync schema without migrations (dev only)
npx prisma generate                    # Regenerate Prisma Client
npx prisma db seed                     # Run seed script (creates admin@admin.com / admin123)
npx prisma studio                      # Visual database browser
```

No test runner or linter is configured.

## Architecture

Full-stack Nuxt 4 app with Prisma 7 ORM on PostgreSQL, using `@sidebase/nuxt-auth` for JWT authentication and Element Plus for UI.

### Frontend (app/)

- **Routing**: File-system routing — `app/pages/*.vue` auto-maps to routes
- **Layouts**: `app/layouts/default.vue` is the global layout (header with auth state + main content)
- **Auth guard**: `app/middleware/auth.ts` checks `useAuth().status` and redirects unauthenticated users to `/login`
- **Page auth rules**: Protected pages use `definePageMeta({ middleware: 'auth' })`. Public-only pages (login, register, forgot/reset-password) use `definePageMeta({ auth: { unauthenticatedOnly: true, navigateAuthenticatedTo: '/' } })`
- **Auth composable**: `useAuth()` from `@sidebase/nuxt-auth` provides `status`, `data`, `signIn`, `signOut`

### Backend (server/)

- **API routing**: `server/api/<path>.<method>.ts` auto-maps to endpoints. `[param].ts` = dynamic route segment. `index.ts` = directory root.
- **Handler pattern**: All API handlers use `defineEventHandler`. Standard flow: authenticate via `getUserFromToken(event)` → validate input with Zod via `readValidatedBody(event, schema.parse)` → Prisma query → return result
- **Auth utilities** (`server/utils/auth.ts`): `hashPassword`, `verifyPassword` (bcryptjs), `generateToken`, `verifyToken` (JWT, 24h expiry), `getUserFromToken` (extracts from Authorization header)
- **Prisma client** (`server/utils/prisma.ts`): Uses `@prisma/adapter-pg` with `pg.Pool`. Parses `schema` param from `DATABASE_URL` to set `search_path`. Global singleton in dev to survive hot reloads.

### Database (prisma/)

- **Prisma 7 config**: `prisma.config.ts` at project root uses `defineConfig` API (not the old generator block). Schema file at `prisma/schema.prisma`.
- **Models**: `User` (UUID pk, bcrypt password, role as string enum), `PasswordReset` (token-based with expiry, related to User via email not id), `SystemSetting` (key-value store with upsert)
- **Non-public schema**: The project uses a custom PostgreSQL schema (e.g. `lixiangpai`), configured via `?schema=` in `DATABASE_URL`. Raw SQL in seed.ts must use `"schema"."Table"` quoting.
- **Generated client** output goes to `app/generated/prisma/` (gitignored)

### Environment Variables

Required in `.env` (see `.env.example`):
- `DATABASE_URL` — PostgreSQL connection string with `?schema=` parameter
- `AUTH_ORIGIN` — App base URL (e.g. `http://localhost:3000`)
- `AUTH_SECRET` — JWT signing secret

Runtime config is exposed via `nuxt.config.ts` `runtimeConfig` (accessible server-side only).

## Key Conventions

- **Language**: UI text and error messages are in Chinese (中文)
- **Validation**: Zod schemas for all API input validation; error messages in Chinese
- **Auth endpoints**: `/api/auth/{login,register,logout,me,forgot-password,reset-password}` — configured in `nuxt.config.ts` under `auth.provider.endpoints`
- **Password reset**: Anti-enumeration pattern — `forgot-password` returns success regardless of whether email exists
- **Role field**: Uses `String` type with values `"USER"` / `"ADMIN"` rather than Prisma enum

## Skills Usage Guide

This project has access to Claude Code Skills (slash commands). Below are the most relevant skills for this Nuxt 4 + Prisma 7 full-stack app:

### Development Workflow

| Skill | Trigger | Use When |
|-------|---------|----------|
| `dev:code-review` | `/dev:code-review` | Reviewing code changes for quality and best practices |
| `dev:refactor-code` | `/dev:refactor-code` | Refactoring existing code for clarity and performance |
| `dev:debug-error` | `/dev:debug-error` | Diagnosing runtime errors or unexpected behavior |
| `dev:explain-code` | `/dev:explain-code` | Explaining complex code or patterns |
| `dev:incremental-feature-build` | `/dev:incremental-feature-build` | Building features step-by-step with validation |
| `dev:remove-dead-code` | `/dev:remove-dead-code` or `/remove-dead-code` | Cleaning up unused code, imports, and dependencies |
| `dev:fix-issue` | `/dev:fix-issue` | Fixing a specific bug or issue |

### Project Setup & Configuration

| Skill | Trigger | Use When |
|-------|---------|----------|
| `setup:setup-development-environment` | `/setup:setup-development-environment` | Setting up dev environment for new contributors |
| `setup:setup-linting` | `/setup:setup-linting` | Adding ESLint/Prettier (currently not configured) |
| `setup:setup-formatting` | `/setup:setup-formatting` | Adding code formatting tools |
| `setup:setup-rate-limiting` | `/setup:setup-rate-limiting` | Adding API rate limiting for auth endpoints |
| `setup:design-rest-api` | `/setup:design-rest-api` | Designing new API endpoints |
| `setup:design-database-schema` | `/setup:design-database-schema` | Designing or extending Prisma schemas |
| `setup:setup-monitoring-observability` | `/setup:setup-monitoring-observability` | Adding logging, monitoring, or tracing |

### Testing

| Skill | Trigger | Use When |
|-------|---------|----------|
| `test:write-tests` | `/test:write-tests` | Writing tests for existing or new code (no test runner configured yet) |
| `test:setup-comprehensive-testing` | `/test:setup-comprehensive-testing` | Setting up Vitest + testing framework from scratch |
| `test:test-coverage` | `/test:test-coverage` | Adding coverage reporting |
| `test:e2e-setup` | `/test:e2e-setup` | Setting up Playwright E2E tests |
| `webapp-testing` | `/webapp-testing` | Interactive web app testing and debugging |

### Security & Performance

| Skill | Trigger | Use When |
|-------|---------|----------|
| `security:security-audit` | `/security:security-audit` | Auditing codebase for security vulnerabilities |
| `security:security-hardening` | `/security:security-hardening` | Hardening auth, input validation, and API security |
| `security:dependency-audit` | `/security:dependency-audit` | Auditing npm dependencies for vulnerabilities |
| `performance:performance-audit` | `/performance:performance-audit` | Auditing app performance (SSR, bundle size, DB queries) |
| `performance:optimize-database-performance` | `/performance:optimize-database-performance` | Optimizing Prisma queries and PostgreSQL indexes |
| `performance:optimize-bundle-size` | `/performance:optimize-bundle-size` | Reducing frontend bundle size |
| `performance:implement-caching-strategy` | `/performance:implement-caching-strategy` | Adding caching for API or database queries |

### Deployment & CI/CD

| Skill | Trigger | Use When |
|-------|---------|----------|
| `deploy:ci-setup` | `/deploy:ci-setup` | Setting up CI/CD pipelines |
| `deploy:containerize-application` | `/deploy:containerize-application` | Adding Docker support |
| `deploy:setup-automated-releases` | `/deploy:setup-automated-releases` | Automating release workflows |
| `deploy:prepare-release` | `/deploy:prepare-release` | Preparing a production release |

### Documentation

| Skill | Trigger | Use When |
|-------|---------|----------|
| `docs:generate-api-documentation` | `/docs:generate-api-documentation` | Generating API docs from server routes |
| `docs:create-onboarding-guide` | `/docs:create-onboarding-guide` | Creating developer onboarding documentation |
| `docs:create-architecture-documentation` | `/docs:create-architecture-documentation` | Documenting system architecture |
| `docs:migration-guide` | `/docs:migration-guide` | Writing migration guides for Prisma or API changes |

### Code Quality & Maintenance

| Skill | Trigger | Use When |
|-------|---------|----------|
| `simplify` | `/simplify` | Reviewing changed code for reuse, quality, and efficiency |
| `code-review-skill` | `/code-review-skill` | Quick code review |
| `security-review` | `/security-review` | Security-focused code review |
| `review` | `/review` | General code review |

### Proactive Skill Usage

When working on this project, Claude should **proactively** invoke skills in these scenarios:

- After writing or modifying code → consider `/dev:code-review` or `/simplify`
- When adding new API endpoints → consider `/setup:design-rest-api` first
- When modifying Prisma schema → consider `/setup:design-database-schema`
- Before deploying → run `/security:security-audit` and `/performance:performance-audit`
- When the user reports an error → use `/dev:debug-error`
- When setting up this project from scratch → use `/setup:setup-development-environment`
