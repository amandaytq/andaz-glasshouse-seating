# Deploying to AWS Amplify (static SPA) + S3-backed shared layout

**This project's resources**

| | |
|---|---|
| Region | `ap-southeast-1` |
| S3 bucket | `andaz-glasshouse-seating` |
| S3 object (the whole "database") | `layout.json` |

Put the Lambda and the Amplify app in `ap-southeast-1` too.

Amplify Hosting serves **static files only** — it can't run `server/index.js`, and
it has no persistent disk. So in production:

- **Amplify Hosting** serves the built SPA (`dist/`).
- A **Lambda** (`lambda/index.mjs`) serves `GET/PUT/POST /api/layout`, storing the
  one shared layout document as a single **S3 object**.
- An Amplify **rewrite** proxies `/api/<*>` to the Lambda, so the frontend keeps
  calling the same relative `/api/layout` path — no code change.

`npm run dev` and `npm run serve` still use the local file store; nothing about
local development changes.

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
npm run pack:lambda     # -> layout-lambda.zip  (index.mjs + a copy of src/defaultLayout.js)
```

Create the function in **`ap-southeast-1`** (console or CLI):

- **Runtime:** Node.js 20.x  •  **Handler:** `index.handler`  •  **Architecture:** arm64 is fine
- **Code:** upload `layout-lambda.zip`
- **Environment variables:**
  - `LAYOUT_S3_BUCKET` = `andaz-glasshouse-seating`
  - `LAYOUT_S3_KEY` = `layout.json` (optional; this is the default)
- **Execution role policy** — read/write the object, plus `ListBucket` on the
  bucket (without it, a missing `layout.json` returns 403 AccessDenied instead of
  404, so the first-run seed never happens):
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
aws iam put-role-policy --role-name <lambda-execution-role> --policy-name s3 \
  --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:GetObject","s3:PutObject"],"Resource":"arn:aws:s3:::andaz-glasshouse-seating/layout.json"},{"Effect":"Allow","Action":["s3:ListBucket"],"Resource":"arn:aws:s3:::andaz-glasshouse-seating"}]}'

aws lambda create-function --region ap-southeast-1 \
  --function-name glasshouse-layout \
  --runtime nodejs20.x --handler index.handler \
  --zip-file fileb://layout-lambda.zip \
  --role arn:aws:iam::<acct>:role/<lambda-execution-role> \
  --environment "Variables={LAYOUT_S3_BUCKET=andaz-glasshouse-seating}"

aws lambda create-function-url-config --region ap-southeast-1 \
  --function-name glasshouse-layout --auth-type NONE \
  --cors '{"AllowOrigins":["*"],"AllowMethods":["GET","PUT","POST","OPTIONS"],"AllowHeaders":["content-type"]}'
```

---

## 4. Verify

```bash
curl https://<function-url>/api/layout                     # -> {"rev":1,...} and seeds layout.json in S3
curl https://<your-amplify-domain>/api/layout              # same, through the rewrite
```

Open the site: the header should show **All changes saved**; edits from one
browser appear in another within ~5 s (the client polls). Everyone hits the same
S3 object, so all visitors share one layout.

### Notes
- Last-write-wins (same as the local server) — fine for a single planner.
- `predeploy` after changing `src/defaultLayout.js`: re-run `npm run pack:lambda`
  and re-upload the zip (it bundles a copy of that file for the seed/Reset).
- Alternative to the rewrite: build with
  `VITE_LAYOUT_API=https://<function-url>/api/layout` and skip the `/api/<*>`
  rule — the app will call the Function URL directly (CORS is already handled).
