# Model Schema Auto Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild model records around name, description, source, embedded files, embedded images, and best-effort automatic preview images.

**Architecture:** Keep the current document-store architecture. Model files and model images live inside each model record, while upload endpoints append normalized file/image objects. Preview generation is isolated in a helper so `.3mf` extraction and Windows shell thumbnails can fail without breaking uploads.

**Tech Stack:** Node.js, Express, Multer, React Native/Expo, existing JSON document store, existing local file storage helpers.

---

### Task 1: Backend model data and upload endpoints

**Files:**
- Modify: `backend/routes/models.js`
- Modify: `backend/routes/files.js`
- Create: `backend/utils/modelPreview.js`

- [ ] Replace model normalization with `id`, `name`, `description`, `source`, `files`, `images`, `createdAt`, `updatedAt`.
- [ ] Validate `name`, `description`, and `source` on create/update.
- [ ] Add `POST /api/models/:id/files` for `stl`, `obj`, `3mf`, `step`, `stp`, and `zip`.
- [ ] Add `POST /api/models/:id/images` for `jpg`, `jpeg`, `png`, and `webp`.
- [ ] Add best-effort preview generation after model file upload.
- [ ] Delete stored files and images when deleting a model.
- [ ] Update file download MIME types for new model and image extensions.

### Task 2: Frontend API and screens

**Files:**
- Modify: `utils/api.js`
- Modify: `screens/CreateModelScreen.js`
- Modify: `screens/ModelsScreen.js`
- Modify: `screens/ModelDetailScreen.js`

- [ ] Replace old `uploadFile`/`addVersion` calls with `uploadModelFile` and `uploadImage`.
- [ ] Create model with `name`, `description`, and `source`.
- [ ] Show model list cards using `cover`, then `auto_preview`, then placeholder.
- [ ] Show detail screen with description, source, image gallery, and file list.
- [ ] Allow uploading additional model files and manual images from detail.

### Task 3: Verification

**Files:**
- Modify: `backend/scripts/verify-api.js`

- [ ] Update API verification to create the new model shape.
- [ ] Verify `.stl`, `.3mf`, `.step`, and image uploads.
- [ ] Verify uploaded model detail includes `files` and `images`.
- [ ] Verify preview warnings do not fail file upload.
- [ ] Run `npm --prefix backend run verify`.

### Task 4: Final checks

**Files:**
- Inspect: changed files only

- [ ] Run `git diff --check`.
- [ ] Review changed model fields for old `dimensions`, `estimatedMaterialGrams`, `visibility`, and `versions` usage in model screens/routes.
- [ ] Report any verification failures clearly.
