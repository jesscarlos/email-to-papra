# email-to-papra

Forwards emails and attachments from an IMAP inbox to Papra, routing by recipient address.

When run, it checks your inbox for unread emails and for each one:
1. Converts the email body to a PDF and uploads it to Papra
2. Uploads any attachments directly to Papra
3. Optionally moves the email to trash after a successful import

## Requirements

- Node.js 18+
- An IMAP-enabled email account
- A [Papra](https://papra.app) account with an API token

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `IMAP_USER` | Yes | Your email address |
| `IMAP_PASSWORD` | Yes | Your email password or app password |
| `IMAP_HOST` | Yes | IMAP server hostname (e.g. `imap.gmail.com`) |
| `IMAP_PORT` | No | IMAP port, defaults to `993` |
| `PAPRA_API_TOKEN` | Yes | Your Papra API token |
| `PAPRA_DEFAULT_ORG_ID` | Yes | Fallback Papra organization ID |
| `PAPRA_BASE_URL` | No | Papra API base URL, defaults to `https://api.papra.app` |
| `EMAIL_TO_ORG_MAP` | No | JSON map of recipient email → Papra org ID (see below) |
| `TRASH_AFTER_IMPORT` | No | Move email to trash after successful import, defaults to `false` |
| `TRASH_FOLDER` | No | Trash folder name, defaults to `Trash` (see below) |

### 3. Run

```bash
node index.js
```

## Routing emails to different Papra organizations

You can forward emails to different Papra organizations based on the recipient address using `EMAIL_TO_ORG_MAP`. Set it as a JSON string in your `.env`:

```
EMAIL_TO_ORG_MAP={"receipts@yourdomain.com":"org_abc123","invoices@yourdomain.com":"org_def456"}
```

If the recipient address doesn't match any entry in the map, the email is routed to `PAPRA_DEFAULT_ORG_ID`.

## Skipping the email body PDF

If you only want to import attachments and skip generating a PDF of the email body, include the following text anywhere in the email body:

```
{{papra_attachments_only}}
```

## Trash folder names by provider

If `TRASH_AFTER_IMPORT=true`, set `TRASH_FOLDER` to match your provider:

| Provider | Folder name |
|---|---|
| Gmail | `[Gmail]/Trash` |
| Outlook / Hotmail | `Deleted Items` |
| Apple iCloud | `Deleted Messages` |
| Most others | `Trash` |

## Running with Docker

### Option 1: Use the pre-built image

```bash
docker run --env-file .env jesscarlos/email-to-papra:latest
```

### Option 2: Build it yourself

Build the image:

```bash
docker build -t email-to-papra .
```

Run with your `.env` file:

```bash
docker run --env-file .env email-to-papra
```

## Running on a schedule

The script processes unread emails and exits. To run it on a recurring schedule, use a cron job or a process scheduler.

**cron example (every 15 minutes):**

```
*/15 * * * * docker run --env-file /path/to/.env email-to-papra
```

## License

This project is licensed under the AGPL-3.0 License - see the [LICENSE](./LICENSE) file for details.
