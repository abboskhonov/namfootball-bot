# NamFootball Bot ⚽

Telegram bot for managing football tournament leagues, teams, and players. Built with [grammy](https://grammy.dev) + [Drizzle ORM](https://orm.drizzle.team) + [Bun](https://bun.sh).

## Features

- 🏆 **Leagues** — Admin creates and manages tournament leagues
- 👥 **Teams** — Captains create teams, admin approves them
- 👤 **Players** — Captains add players with name, last name, and ID/passport photo
- 📸 **ID Photos** — Stored on Telegram cloud, viewable by admin
- ⚙️ **Admin Panel** — Full button-driven admin interface

## Setup

### 1. Requirements

- [Bun](https://bun.sh) runtime
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- A private Telegram group for the gate check

### 2. Clone & install

```sh
git clone https://github.com/abboskhonov/namfootball-bot.git
cd namfootball-bot
bun install
```

### 3. Configure

```sh
cp .env.example .env
```

Edit `.env`:

```
BOT_TOKEN=your_bot_token_from_botfather
GROUP_ID=-1001234567890
ADMIN_IDS=6802457909
```

- **BOT_TOKEN** — Get from [@BotFather](https://t.me/BotFather)
- **GROUP_ID** — Your private group's chat ID. Add the bot to the group first, then run the bot and use a test to find the ID (supergroups use `-100` prefix)
- **ADMIN_IDS** — Comma-separated Telegram user IDs of admins

### 4. Run

```sh
bun run dev
```

The bot starts long-polling for updates.

### 5. Add bot to your group

Add the bot as a **member** (not admin) of your private group. The gate check will verify membership before allowing anyone to use the bot.

## Usage

### User commands

| Command | Description |
|---|---|
| `/start` | Open main menu |
| `/leagues` | View active leagues |
| `/create_team` | Create a new team |

The main menu is fully button-driven — tap around to explore.

### User flow

1. **Browse leagues** — `/start` → `🏆 Ligalar`
2. **Create a team** — `➕ Jamoa yaratish` → pick a league → type team name
3. **Wait for approval** — Admin gets notified, approves via button
4. **Add players** — `👥 Mening jamoam` → `➕ O'yinchi qo'shish`
5. **Fill player info** — First name → Last name → ID/passport photo → Phone (optional)
6. **Manage roster** — Edit team name, view players list, delete players, delete team

### Admin commands

| Command | Description |
|---|---|
| `/start` | Open admin panel |
| `/admin` | Open admin panel |
| `/pending_teams` | Approve or reject teams |
| `/players` | View all players |
| `/addleague` | Create a league via text |

### Admin flow

1. **Create a league** — `➕ Yangi liga` → type the name
2. **Approve teams** — `👥 Kutilayotgan` → tap a team → ✅ Accept / ❌ Reject
3. **View players** — `🎮 O'yinchilar` → tap a player → `📸 ID rasmni ko'rish`
4. **League details** — `🏆 Ligalar` → tap a league → see teams and stats

### Notifications

- When a team is created, admins get an Accept/Reject button directly in chat
- When a player is added, admins receive the player's ID photo with details

## Tech Stack

- **[grammy](https://grammy.dev)** — Telegram bot framework
- **[Drizzle ORM](https://orm.drizzle.team)** — Database ORM
- **[bun:sqlite](https://bun.sh/docs/api/sqlite)** — SQLite database
- **[@grammyjs/conversations](https://grammy.dev/plugins/conversations)** — Multi-step conversations

## Database

SQLite database stored in `data/namfootball.db`. Schema is managed via Drizzle:

```sh
# Push schema changes
bunx drizzle-kit push

# Generate migrations
bunx drizzle-kit generate
```

## Project Structure

```
src/
  index.ts              — Entry point
  config.ts             — Environment config
  types.ts              — Shared types
  bot.ts                — Bot setup, main menu, navigation
  db/
    schema.ts           — Drizzle schema
    db.ts               — Database connection
  features/
    gate.ts             — Group membership check
    admin.ts            — Admin panel, leagues, approve/reject
    team.ts             — Create team conversation
    team_management.ts  — Captain's team & player management
    league.ts           — League listing
```
