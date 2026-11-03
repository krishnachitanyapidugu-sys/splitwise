# Splitwise — requirements

Epic **SPLITWISE-EPIC-01 · Shared expenses**: people sign in, form groups, add shared expenses, see who owes whom and
settle up. These are the same stories and acceptance criteria as the ADIS project "Splitwise".

## STORY-01 · Sign in to Splitwise
As a user I sign in with my email and password so that I see my groups and balances.
1. Given a registered user, when they sign in with the right email and password, then the dashboard opens and shows their name.
2. Given a registered user, when they sign in with a wrong password, then "Email or password is incorrect" is shown and they stay on the sign-in page.
3. Given five wrong passwords in a row, when the user tries again, then the account is locked for 15 minutes and a message says so.

## STORY-02 · Create a group and add members
As a user I create a group (a trip, a flat) and add friends to it so we can share expenses.
1. Given a signed-in user, when they create a group with a name and a type, then the group opens with them as its admin.
2. Given the new group form, when the name is left empty, then "Name is required" is shown and no group is created.
3. Given a group the user admins, when they add a friend, then the friend is listed as a member.

## STORY-03 · Add an expense and split it
As a group member I add an expense, say who paid, and split it between members.
1. Given a group with two members, when an expense of 1200.00 is added split equally, then each member owes 600.00.
2. Given an unequal split, when the shares do not add up to the amount, then the expense cannot be saved and the difference is shown.
3. Given an expense added by one member, when another member opens their activity, then the expense is listed there.

## STORY-04 · See balances and settle up
As a group member I see who owes whom and record a payment to settle up.
1. Given expenses in a group, when the member opens Balances, then each person shows how much they owe or are owed.
2. Given a member who owes 600.00, when a cash settlement of 600.00 is recorded, then both balances become 0.00.
3. Given a settlement is recorded, when it is saved, then the person who was paid gets an email about it.
4. Given a group, when the balances API is called, then it returns each member's net amount.

## STORY-05 · Fast and accessible to everyone
The app is quick to load and usable with a keyboard and a screen reader; amounts read naturally.
1. Given a signed-in user with five groups, when the dashboard opens, then it is fully shown within 2 seconds.
2. Given a screen reader user, when they add an expense, then every field and button is announced with its label.
3. Given amounts in Indian rupees, when they are shown, then they use the ₹ sign and Indian digit grouping (₹1,20,000.00).

## How the app meets them

| Criterion | Where |
|---|---|
| 01.1–01.3 | `GET/POST /login` — 5 wrong passwords set `users.locked_until` to 15 minutes ahead |
| 02.1–02.3 | `/groups/new`, `/groups/:id`, `/groups/:id/members/new` (admins only) |
| 03.1–03.2 | `/groups/:id/expenses/new` — equal split spreads the paise; unequal shares must add up exactly |
| 03.3 | `/activity` — expenses in every group you belong to |
| 04.1–04.2 | `/groups/:id/balances`, `/groups/:id/settle` |
| 04.3 | Settling up writes an email to both people into `email_outbox`; read them at `/dev/mailbox?email=…` |
| 04.4 | `GET /api/groups/:id/balances` with `Authorization: Bearer <token>` |
| 05.1 | Server-rendered pages, one query per section |
| 05.2 | Every input has a `<label>`, every action is a real `<button>` or link |
| 05.3 | `formatINR` uses `Intl.NumberFormat('en-IN', { currency: 'INR' })` |
