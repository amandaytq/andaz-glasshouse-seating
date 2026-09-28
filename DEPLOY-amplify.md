# Deploying to AWS Amplify (static SPA) + S3-backed layout + DynamoDB guests

**This project's resources**

| | |
|---|---|
| Region | `ap-southeast-1` |
| S3 bucket | `andaz-glasshouse-seating` |
| S3 object (the table/furniture layout "database") | `layout.json` |
| DynamoDB table (the guest-list "database") | `glasshouse-guests` (create per §4 below) |

Put the Lambda, the DynamoDB table and the Amplify app all in `ap-southeast-1`.

Amplify Hosting serves **static files only** — it can't run `server/index.js`, and
it has no persistent disk. So in production:

- **Amplify Hosting** serves the built SPA (`dist/`).
- The **same Lambda** (`lambda/index.mjs`) serves both:
  - `GET/PUT/POST /api/layout` — the tables/furniture/zone document, stored as a
    single **S3 object** (last-write-wins; fine, one person edits the floor plan).
  - `GET/PUT/DELETE/POST /api/guests*` — the guest list, stored as **individual
    DynamoDB rows/items**, one per guest, so ~100–200 people can each edit their
    own row (name, RSVP, meal, seat) at once without overwriting each other —
    see `src/useGuests.js` for the client side and `## 4` below for the table.
- An Amplify **rewrite** proxies `/api/<*>` to the Lambda, so the frontend keeps
  calling the same relative `/api/layout` and `/api/guests` paths — no code change.

`npm run dev` and `npm run serve` still use local file stores (`server/data/`);
nothing about local development changes.

---

## 1. Frontend on Amplify

### Option A — Git-connected (recommended)
Connect the repo in the Amplify console. It picks up [`amplify.yml`](amplify.yml)
(`npm ci` → `npm run build` → publish `dist/`).

### Option B — Manual (drag-and-drop) deploy
```bash
npm run pack:web        # builds, then zips the CONTENTS of dist/ -> glasshouse-web.zip
```
Upload `glasshouse-web.zip` in the Amplify console. The zip's root is
`index.html` + `assets/…` (not a `dist/` folder), which is what Amplify expects.

### SPA rewrite (required either way)
Amplify console → **App settings → Rewrites and redirects** → add, in this order:

| Source address | Target address | Type |
|---|---|---|
| `/api/<*>` | `https://<your-lambda-function-url>/api/<*>` | `200 (Rewrite)` |
| `/<*>` | `/index.html` | `404-200 (Rewrite)` |

(The `/api` rule must come first so it isn't swallowed by the SPA catch-all.)

---

## 2. S3 bucket

Already created: **`andaz-glasshouse-seating`** in **`ap-southeast-1`**. Keep it
private (block all public access). The Lambda reads/writes one object,
`layout.json`, and seeds it with the blueprint on first `GET`.

---

## 3. Lambda

```bash
npm run pack:lambda     # -> layout-lambda.zip (index.mjs + copies of src/defaultLayout.js and src/data/)
```

Create the function in **`ap-southeast-1`** (console or CLI):

- **Runtime:** Node.js 20.x  •  **Handler:** `index.handler`  •  **Architecture:** arm64 is fine
- **Code:** upload `layout-lambda.zip`
- **Environment variables:**
  - `LAYOUT_S3_BUCKET` = `andaz-glasshouse-seating`
  - `LAYOUT_S3_KEY` = `layout.json` (optional; this is the default)
  - `GUESTS_TABLE_NAME` = `glasshouse-guests` (create the table first — see `## 4` below)
- **Execution role policy** — S3 read/write + `ListBucket` (without `ListBucket`,
  a missing `layout.json` returns 403 AccessDenied instead of 404, so the
  first-run seed never happens), plus DynamoDB read/write/scan on the guests
  table:
  ```json
  {
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": ["s3:GetObject", "s3:PutObject"],
        "Resource": "arn:aws:s3:::andaz-glasshouse-seating/layout.json"
      },
      {
        "Effect": "Allow",
        "Action": ["s3:ListBucket"],
        "Resource": "arn:aws:s3:::andaz-glasshouse-seating"
      },
      {
        "Effect": "Allow",
        "Action": [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:DeleteItem",
          "dynamodb:Scan",
          "dynamodb:BatchWriteItem"
        ],
        "Resource": "arn:aws:dynamodb:ap-southeast-1:*:table/glasshouse-guests"
      }
    ]
  }
  ```
- **Function URL:** enable it. Auth type **NONE** (the handler sends permissive
  CORS headers; the data is a non-sensitive seating chart). Copy the URL into the
  `/api/<*>` rewrite target above.
- **Timeout:** 10s is plenty.

CLI equivalent:
```bash
aws iam put-role-policy --role-name <lambda-execution-role> --policy-name glasshouse-data \
  --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:GetObject","s3:PutObject"],"Resource":"arn:aws:s3:::andaz-glasshouse-seating/layout.json"},{"Effect":"Allow","Action":["s3:ListBucket"],"Resource":"arn:aws:s3:::andaz-glasshouse-seating"},{"Effect":"Allow","Action":["dynamodb:GetItem","dynamodb:PutItem","dynamodb:DeleteItem","dynamodb:Scan","dynamodb:BatchWriteItem"],"Resource":"arn:aws:dynamodb:ap-southeast-1:*:table/glasshouse-guests"}]}'

aws lambda create-function --region ap-southeast-1 \
  --function-name glasshouse-layout \
  --runtime nodejs20.x --handler index.handler \
  --zip-file fileb://layout-lambda.zip \
  --role arn:aws:iam::<acct>:role/<lambda-execution-role> \
  --environment "Variables={LAYOUT_S3_BUCKET=andaz-glasshouse-seating,GUESTS_TABLE_NAME=glasshouse-guests}"

aws lambda create-function-url-config --region ap-southeast-1 \
  --function-name glasshouse-layout --auth-type NONE \
  --cors '{"AllowOrigins":["*"],"AllowMethods":["GET","PUT","POST","DELETE","OPTIONS"],"AllowHeaders":["content-type"]}'
```

If the function already exists (you're adding guests to an existing deploy),
update it instead of creating it:
```bash
aws lambda update-function-code --region ap-southeast-1 \
  --function-name glasshouse-layout --zip-file fileb://layout-lambda.zip

aws lambda update-function-configuration --region ap-southeast-1 \
  --function-name glasshouse-layout \
  --environment "Variables={LAYOUT_S3_BUCKET=andaz-glasshouse-seating,GUESTS_TABLE_NAME=glasshouse-guests}"
```

---

## 4. DynamoDB (guest list)

One table, `glasshouse-guests`, holds every guest as its own item/row — that's
what lets ~100–200 people edit the list at once without one save overwriting
another (see `src/useGuests.js`). On-demand billing needs no capacity planning
and costs nothing when idle, which fits a wedding's traffic pattern (near-zero,
then a burst).

Console: DynamoDB → **Create table**
- **Table name:** `glasshouse-guests`
- **Partition key:** `id` — **String**
- No sort key.
- **Table settings:** on-demand (pay-per-request) — the default under "Table
  class and read/write capacity settings" in the console.

CLI equivalent:
```bash
aws dynamodb create-table --region ap-southeast-1 \
  --table-name glasshouse-guests \
  --attribute-definitions AttributeName=id,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST
```

**You don't need to migrate your current seating by hand.** The first `GET
/api/guests` against an empty table seeds it automatically from
`buildDefaultGuests()` (`lambda/data/defaultGuests.js`), which reads the guest
roster and seat assignments already synced into `src/data/brideGuests.js`,
`src/data/groomGuests.js` and `src/defaultLayout.js` — i.e. whatever your most
recent production seating was. If you've made further edits live since that
sync, re-sync those files before creating the table so the seed matches.

⚠️ **Guests "Reset"** re-seeds from the same source and deletes every row not
in it — same caveat as the existing layout Reset, just for the guest list.

---

## 5. Verify

```bash
curl https://<function-url>/api/layout                     # -> {"rev":1,...} and seeds layout.json in S3
curl https://<function-url>/api/guests                     # -> [ {...}, ... ] and seeds the DynamoDB table
curl https://<your-amplify-domain>/api/layout              # same, through the rewrite
curl https://<your-amplify-domain>/api/guests               # same, through the rewrite
```

Open the site: the header should show **All changes saved**; layout edits from
one browser appear in another within ~5 s (the client polls), and guest edits
save per-row so two people editing different guests never clobber each other.

### Notes
- The layout document (tables/furniture) is still last-write-wins — fine, since
  normally only one person rearranges the floor plan.
- The guest list is not — each guest is its own DynamoDB row, so concurrent
  edits from different people land independently. Two people editing the exact
  same field on the exact same guest at the same moment still has the second
  save win (there's no field-level merge), which is an acceptable, rare edge
  case at this scale.
- `predeploy` after changing `src/defaultLayout.js`, `src/data/brideGuests.js` or
  `src/data/groomGuests.js`: re-run `npm run pack:lambda` and re-upload the zip
  (it bundles copies of these for the seed/Reset).
- Alternative to the rewrite: build with
  `VITE_LAYOUT_API=https://<function-url>/api/layout` and
  `VITE_GUESTS_API=https://<function-url>/api/guests`, and skip the `/api/<*>`
  rule — the app will call the Function URL directly (CORS is already handled).
