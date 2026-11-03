# Splitwise

A small Splitwise: sign in, create groups, add shared expenses (equal or unequal splits), see who owes whom, settle up,
and read balances over an API. Node 20+, Express, MySQL 8, server-rendered pages. Requirements: [REQUIREMENTS.md](REQUIREMENTS.md).

## Run it

```bash
cp .env.example .env      # fill in the database user, a session secret and the seed password / API token
npm install
npm run db:reset          # create the tables and seed the baseline users (drops existing data)
npm start                 # http://localhost:5173
npm run smoke             # with the app running: checks every acceptance criterion over HTTP
```

Seeded people (password = `SEED_PASSWORD` from `.env`): `alice@splitwise.test`, `bob@splitwise.test`,
`carol@splitwise.test`, and `dave@splitwise.test` — the account the lockout test is allowed to lock.
Alice also gets the API token `SEED_API_TOKEN`.

Groups and expenses are not seeded: each test creates what it needs (ADIS does this with its test data).

## Pages

| Path | What |
|---|---|
| `/login` | Sign in. Five wrong passwords lock the account for 15 minutes. |
| `/` | Dashboard: your groups and your balance in each. |
| `/groups/new` | New group (name required). |
| `/groups/:id` | Group: members, expenses, and links to add an expense, add a member (admins), settle up, balances. |
| `/groups/:id/expenses/new` | Add an expense, split equally or unequally (shares must add up). |
| `/groups/:id/balances` | Who owes whom. |
| `/groups/:id/settle` | Record a payment; both people get an email. |
| `/activity` | Expenses across your groups. |
| `/api/groups/:id/balances` | JSON balances; `Authorization: Bearer <token>`. |
| `/dev/mailbox?email=…` | Development only: the emails the app "sent". |
| `/health` | Liveness + database check. |
