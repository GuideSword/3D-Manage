# 3D Manage Backend

Express API for the 3D printing management app. It supports authenticated CRUD flows for orders, models, materials, stock lots, inventory transactions, CSV import/export, local file uploads, and Aliyun OSS signed URLs.

## Quick Start

```bash
npm install
npm run store:init
npm run dev
```

The API listens on `http://localhost:3001` by default. Override with `PORT`.

## Environment

```bash
PORT=3001
JWT_SECRET=replace-with-a-long-random-secret

# file store, default
STORE_DRIVER=file
DATA_DIR=./data
UPLOAD_DIR=./uploads

# PostgreSQL JSONB store, optional
# STORE_DRIVER=postgres
# DATABASE_URL=postgres://user:password@localhost:5432/3d_manage
# DATABASE_SSL=false
# STORE_TABLE=app_store
# STORE_ID=default

# Aliyun OSS, optional when callers do not pass credentials per request
# OSS_ACCESS_KEY_ID=
# OSS_ACCESS_KEY_SECRET=
# OSS_BUCKET=
# OSS_REGION=oss-cn-hangzhou
```

`STORE_DRIVER=file` writes one JSON file at `DATA_DIR/store.json`. `STORE_DRIVER=postgres` writes the same application document into one JSONB row, so existing routes keep the same behavior while deployment can use PostgreSQL-backed persistence.

Run `npm run store:init` before deployment to create the local file or PostgreSQL table with clean business collections. `npm run db:sync` is kept as a compatibility alias for the same command.

## Authentication

The first login or registration bootstraps an owner account when no users exist:

```text
admin@example.com / Admin123456
```

Business APIs require `Authorization: Bearer <token>`. Public registration creates non-owner users only; owner-level actions require an owner token.

## Verification

```bash
npm run verify
```

The verification script starts the API on a random local port, uses an isolated temp data/upload directory, and checks auth, permissions, orders, models, materials, stock, CSV export, file uploads, OSS URL signing, and store persistence.

## Main API Groups

- `GET /health`
- `POST /api/auth/login`
- `POST /api/auth/register`
- `GET /api/auth/me`
- `/api/orders`
- `/api/models`
- `/api/materials`
- `/api/stock`
- `/api/files/:filePath`
- `/api/oss/*`

Each business group includes list/detail, create/update/delete where applicable, CSV import/export, and audit logging.

## Files

Local uploads are stored under `UPLOAD_DIR`:

- `models/` for STL/OBJ/3MF model files
- `orders/attachments/` for order images/PDFs
- `stock/` for stock-related files
- `previews/` for generated previews

Use `/api/files/:filePath` with an authenticated token to download local files.

## Production Notes

- Set a strong `JWT_SECRET`.
- Put the API behind HTTPS.
- Back up `DATA_DIR` or the PostgreSQL database.
- Back up `UPLOAD_DIR` unless all durable files are stored in OSS.
- Configure reverse proxy upload limits for model files.
