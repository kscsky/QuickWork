-- The built-in workspace agent shipped under a legacy system key. Rename the
-- persisted identity so every server-side lookup uses the Quill key. Keep an
-- owner-edited display name, but replace the product default and the localized
-- description that shipped with the old name.
UPDATE agent
SET system_key = 'quill',
    name = CASE WHEN name = 'Mika' THEN 'Quill' ELSE name END,
    description = replace(description, 'Mika', 'Quill')
WHERE system_key = 'mika';

UPDATE chat_session
SET title = replace(title, 'Mika', 'Quill')
WHERE title LIKE '%Mika%';
