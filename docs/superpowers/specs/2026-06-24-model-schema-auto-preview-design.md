# Model Schema and Auto Preview Design

## Context

The current backend stores application data in one document through `backend/utils/store.js`.
With `STORE_DRIVER=file`, this is `backend/data/store.json`. With PostgreSQL, the same document
is stored in one JSONB row. This project does not currently use real relational tables for
business entities.

Local runtime data currently has no existing model records, so this change can use a clean model
shape without legacy model migration.

## Goal

Simplify model management around the fields the user actually needs:

- Model: name, description, source.
- Files: one model can have multiple uploaded model files.
- Images: one model can have multiple images, including auto-generated previews.

The system should also attempt to create a model preview image after file upload:

1. If the uploaded file is `.3mf`, try to extract an embedded thumbnail.
2. If the backend is running on Windows, try to call Windows thumbnail generation.
3. If preview generation succeeds, save it as an `auto_preview` image.
4. Users can still manually upload `cover` and `real_print` images.

Preview generation is best effort. Upload success must not depend on preview success.

## Data Shape

`models` remains the only model collection in the store document. Each model embeds its files and
images.

```text
model
- id
- name
- description
- source
- files
- images
- createdAt
- updatedAt
```

```text
file
- id
- name
- type
- fileKey
- fileUrl
- size
- sha256
- createdAt
```

```text
image
- id
- name
- type
- fileKey
- fileUrl
- size
- sha256
- sourceFileId
- createdAt
```

`source` values:

```text
original
remix
imported
```

`image.type` values:

```text
cover
real_print
auto_preview
other
```

IDs continue using the current app convention: incrementing string IDs. Model IDs are unique in
`models`. File and image IDs only need to be unique inside their parent model.

## API Design

Create model:

```text
POST /api/models
body: { name, description, source }
```

Required fields:

```text
name
description
source
```

Upload model file:

```text
POST /api/models/:id/files
multipart: file
```

Allowed initial file types:

```text
stl
obj
3mf
step
stp
zip
```

Behavior:

- Save the uploaded file under the model's storage folder.
- Append a file record to `model.files`.
- Attempt auto preview generation.
- If preview generation succeeds, save the image and append an `auto_preview` record to
  `model.images`.
- Return the created file and any generated preview image.

Upload model image:

```text
POST /api/models/:id/images
multipart: file, type
```

Allowed image types:

```text
cover
real_print
other
```

Model detail:

```text
GET /api/models/:id
```

Returns the model with embedded `files` and `images`.

Delete model:

```text
DELETE /api/models/:id
```

Deletes the model record and all stored files referenced by `files` and `images`.

## Frontend Design

Create model screen:

- Name input.
- Description input.
- Source selector: original, remix, imported.
- Optional model file upload.
- Optional image upload.

Model list screen:

- Show name, source, updated time.
- Use `cover` image first, then `auto_preview`, then placeholder.
- Do not show old dimensions, material estimate, visibility, or version fields.

Model detail screen:

- Show name, description, source.
- Show image gallery.
- Show model file list.
- Allow uploading more files.
- Allow uploading cover, real print, and other images.

## Auto Preview Design

Preview generation is a service-level helper used after model file upload.

Flow:

```text
uploaded file
-> if .3mf, try embedded thumbnail extraction
-> if no thumbnail and platform is Windows, try Windows shell thumbnail
-> if preview exists, save PNG/JPG through existing storage helper
-> append image record with type auto_preview
```

Rules:

- Preview failure is logged but does not fail the file upload.
- The first successful `auto_preview` can be used as the list/detail fallback image.
- Manual `cover` images have priority over `auto_preview`.
- `real_print` is never auto-generated because it must be a real printed result photo.

Implementation boundaries:

- Use a small Node helper for `.3mf` ZIP thumbnail extraction by scanning the archive for
  thumbnail-like PNG/JPG assets.
- Use a Windows-only helper for shell thumbnails behind platform detection. If the helper is not
  available or returns no image, the service returns no preview.
- Keep preview helpers isolated from the upload route so Linux/cloud deployments skip Windows
  thumbnail generation cleanly.

## Error Handling

- Missing required model fields returns `400`.
- Unsupported model file extension returns `400`.
- Unsupported image extension or image type returns `400`.
- Uploading to a missing model returns `404`.
- Preview generation errors are recorded in server logs and optionally returned as a warning field,
  but the uploaded file still succeeds.

## Testing

Backend verification should cover:

- Creating a model with `name`, `description`, and `source`.
- Rejecting model creation when required fields are missing.
- Uploading `.stl`, `.3mf`, `.step`, and `.stp` files.
- Rejecting unsupported model file extensions.
- Uploading `cover`, `real_print`, and `other` images.
- Rejecting unsupported image types.
- Returning embedded `files` and `images` from model detail.
- Deleting a model and attempting to delete referenced files.
- Confirming preview generation failure does not fail file upload.

Manual verification should cover:

- Create model from the app.
- Upload a model file and see it in the file list.
- Upload a cover image and see it used in list/detail.
- Upload a real print image and see it in the gallery.
- Upload a `.3mf` file with a thumbnail and verify an `auto_preview` appears when supported.

## Out of Scope

- Real relational PostgreSQL tables.
- Preserving legacy `dimensions`, `estimatedMaterialGrams`, `visibility`, `versions`, and `notes`
  in new model records.
- Automatically creating real printed photos.
- Full CAD rendering for STEP files if Windows shell thumbnail generation is unavailable.
- MakerWorld publishing integration.
