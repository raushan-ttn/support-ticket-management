# Initial Setup Plan — Support Ticket Management (backend-node)

## Goal
Build a Node.js/Express REST API for a support ticket management system using a **monolith modular** architecture — each feature is a self-contained module (routes → controller → service), making it easy to scale or extract into microservices later.

---

## Architecture

### Project Structure
```
backend-node/
├── bin/
│   └── www                        ← HTTP server entry point
├── src/
│   ├── app.js                     ← Express app (middlewares + route mounting)
│   ├── config/
│   │   └── index.js               ← Centralised env/config (reads .env via dotenv)
│   ├── middlewares/
│   │   └── errorHandler.js        ← Global error handler (4-arg Express convention)
│   ├── utils/
│   │   └── response.js            ← Uniform JSON response helpers (success / error)
│   └── modules/                   ← Feature modules (monolith modular boundary)
│       ├── auth/
│       │   ├── auth.routes.js
│       │   ├── auth.controller.js
│       │   └── auth.service.js
│       ├── users/
│       │   ├── user.routes.js
│       │   ├── user.controller.js
│       │   └── user.service.js
│       └── tickets/
│           ├── ticket.routes.js
│           ├── ticket.controller.js
│           └── ticket.service.js
├── .env.example
├── .gitignore
└── package.json
```

### Layer Responsibilities
| Layer | File pattern | Responsibility |
|-------|-------------|----------------|
| Routes | `*.routes.js` | Map HTTP verbs + paths to controller methods |
| Controller | `*.controller.js` | Parse request, call service, send response via `utils/response` |
| Service | `*.service.js` | Business logic, DB calls (to be implemented) |

---

## API Endpoints

### Auth (`/api/v1/auth`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/register` | Register a new user |
| POST | `/login` | Login and receive JWT |

### Users (`/api/v1/users`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List all users |
| GET | `/:id` | Get user by ID |
| PUT | `/:id` | Update user |
| DELETE | `/:id` | Delete user |

### Tickets (`/api/v1/tickets`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List all tickets (supports query filters) |
| POST | `/` | Create a new ticket |
| GET | `/:id` | Get ticket by ID |
| PUT | `/:id` | Update ticket |
| DELETE | `/:id` | Delete ticket |

### Health
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |

---

## Dependencies

### Production
| Package | Purpose |
|---------|---------|
| `express ^4.22.0` | HTTP framework |
| `morgan` | Request logging |
| `cookie-parser` | Cookie parsing |
| `dotenv` | `.env` file loading |
| `debug` | Namespaced debug logging |

### Dev
| Package | Purpose |
|---------|---------|
| `nodemon` | Auto-restart on file change |

---

## Scripts
```bash
npm start        # Production — node ./bin/www
npm run dev      # Development — nodemon ./bin/www
```

---

## Next Steps (To Do)

- [ ] Copy `.env.example` → `.env` and fill in real values
- [ ] Add database integration (Mongoose for MongoDB)
  - [ ] Create Mongoose models: `User`, `Ticket`
  - [ ] Wire models into service files
- [ ] Implement authentication
  - [ ] Hash passwords with `bcrypt`
  - [ ] Sign JWTs with `jsonwebtoken`
  - [ ] Add `authenticate` middleware for protected routes
- [ ] Add input validation (e.g. `joi` or `express-validator`)
- [ ] Add role-based access control (admin / agent / user)
- [ ] Add pagination to list endpoints
- [ ] Write tests (Jest + Supertest)
- [ ] Add a linter (ESLint) and formatter (Prettier)
